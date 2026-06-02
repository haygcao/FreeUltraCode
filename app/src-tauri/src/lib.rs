use std::collections::{HashMap, HashSet};
use std::io::{BufRead, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::Emitter;

mod cc_switch_import;
mod cli_runtime;
mod history;

/// Windows CreateProcess flag: don't allocate a console window for the child.
/// Without this, spawning the `claude` console binary pops up a black terminal
/// window every time the app runs a node. No-op on other platforms.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Apply the no-console-window flag to a Command on Windows (no-op elsewhere).
fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

fn terminate_process_tree(pid: u32) -> bool {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        hide_console(&mut cmd);
        return cmd
            .arg("/PID")
            .arg(pid.to_string())
            .arg("/T")
            .arg("/F")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
    }
    #[cfg(not(windows))]
    {
        return Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
    }
}

/// Terminate a spawned CLI and, on Windows, its wrapper descendants too.
fn terminate_child_tree(child: &mut Child) {
    if !terminate_process_tree(child.id()) {
        let _ = child.kill();
    }
    let _ = child.wait();
}

fn active_ai_cli_pids() -> &'static Mutex<HashMap<String, u32>> {
    static ACTIVE: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cancelled_ai_cli_ids() -> &'static Mutex<HashSet<String>> {
    static CANCELLED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    CANCELLED.get_or_init(|| Mutex::new(HashSet::new()))
}

fn register_ai_cli(run_id: &str, pid: u32) {
    if let Ok(mut active) = active_ai_cli_pids().lock() {
        active.insert(run_id.to_string(), pid);
    }
}

fn mark_ai_cli_cancelled(run_id: &str) -> Option<u32> {
    let pid = active_ai_cli_pids()
        .lock()
        .ok()
        .and_then(|active| active.get(run_id).copied());
    if pid.is_some() {
        if let Ok(mut cancelled) = cancelled_ai_cli_ids().lock() {
            cancelled.insert(run_id.to_string());
        }
    }
    pid
}

fn take_ai_cli_cancelled(run_id: &str) -> bool {
    cancelled_ai_cli_ids()
        .lock()
        .map(|mut cancelled| cancelled.remove(run_id))
        .unwrap_or(false)
}

fn unregister_ai_cli(run_id: &str) {
    if let Ok(mut active) = active_ai_cli_pids().lock() {
        active.remove(run_id);
    }
}

/// Map a frontend adapter id to the local CLI binary that runs it.
///
///   claude-code -> claude
///   codex       -> codex
///   gemini      -> gemini
///
/// Unknown adapters fall back to the literal id so a custom CLI on PATH can
/// still be targeted.
/// Best-effort self-heal for a bun-installed `claude` whose binary an
/// interrupted auto-update renamed to `claude.exe.old.<timestamp>` (leaving the
/// CLI broken: "bin executable does not exist on disk / corrupted node_modules").
///
/// If the expected binary is missing but a renamed `.old` copy exists, the newest
/// one is restored. No-op on non-bun / non-Windows installs (paths won't match),
/// so it is safe to call unconditionally before spawning claude. Combined with
/// `DISABLE_AUTOUPDATER=1` on the spawn (which stops the CLI from re-corrupting
/// itself), this keeps the run working across the auto-update breakage loop.
fn repair_claude_binary() {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    if home.is_empty() {
        return;
    }
    let bin_dir = std::path::Path::new(&home)
        .join(".bun")
        .join("install")
        .join("global")
        .join("node_modules")
        .join("@anthropic-ai")
        .join("claude-code")
        .join("bin");
    // The binary is `claude.exe` on Windows, `claude` elsewhere.
    for target_name in ["claude.exe", "claude"] {
        let target = bin_dir.join(target_name);
        if target.exists() {
            return; // healthy
        }
        let prefix = format!("{target_name}.old.");
        let mut newest: Option<(std::time::SystemTime, std::path::PathBuf)> = None;
        if let Ok(entries) = std::fs::read_dir(&bin_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                if name.to_string_lossy().starts_with(&prefix) {
                    if let Ok(modified) = entry.metadata().and_then(|m| m.modified()) {
                        if newest.as_ref().map_or(true, |(t, _)| modified > *t) {
                            newest = Some((modified, entry.path()));
                        }
                    }
                }
            }
        }
        if let Some((_, src)) = newest {
            let _ = std::fs::copy(&src, &target);
            return;
        }
    }
}

/// Write the generated script to a uniquely-named temp file and return its path.
fn write_temp_script(script: &str) -> Result<std::path::PathBuf, String> {
    let mut path = std::env::temp_dir();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    path.push(format!("openworkflow-{stamp}.sh"));
    let mut file = std::fs::File::create(&path).map_err(|e| format!("无法创建临时脚本: {e}"))?;
    file.write_all(script.as_bytes())
        .map_err(|e| format!("写入临时脚本失败: {e}"))?;
    Ok(path)
}

/// Return a unique temp path for CLI side-channel output.
fn temp_output_path(prefix: &str, ext: &str) -> std::path::PathBuf {
    let mut path = std::env::temp_dir();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    path.push(format!("{prefix}-{stamp}.{ext}"));
    path
}

fn spawn_cli_command(binary: &str) -> Command {
    #[cfg(windows)]
    {
        let path = std::path::Path::new(binary);
        let ext = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase());
        if matches!(ext.as_deref(), Some("cmd" | "bat")) {
            let mut cmd = Command::new("cmd");
            hide_console(&mut cmd);
            cmd.arg("/C").arg(binary);
            return cmd;
        }
    }

    let mut cmd = Command::new(binary);
    hide_console(&mut cmd);
    cmd
}

/// Optional launch shell that wraps an AI CLI invocation (see `shellConfig.ts`).
/// `kind` is one of `direct` | `cmd` | `powershell` | `custom`; `path` is the
/// shell executable for `custom` (and optionally `powershell`).
#[derive(serde::Deserialize)]
pub struct ShellSpec {
    pub kind: String,
    #[serde(default)]
    pub path: Option<String>,
}

/// PowerShell single-quoted literal (double any embedded single quotes).
fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// Direct spawn: the historical behaviour (auto `cmd /C` for `.cmd/.bat`).
fn direct_command(binary: &str, args: &[String]) -> Command {
    let mut cmd = spawn_cli_command(binary);
    for a in args {
        cmd.arg(a);
    }
    cmd
}

/// Build the command that launches `binary` with `args`, optionally wrapped in
/// a user-selected launch shell so the AI CLI inherits that shell's
/// environment/PATH. `None`/`direct` preserves the historical direct spawn.
///
/// POSIX shells pass argv natively via `-lc 'exec "$@"'` (no re-quoting, so
/// spaces/special chars are safe). Windows cmd/PowerShell quoting is
/// best-effort. Env vars / working dir / stdio are applied by the caller to the
/// returned (outer) command and inherited by the wrapped child.
fn build_launch_command(binary: &str, args: &[String], shell: &Option<ShellSpec>) -> Command {
    let kind = shell.as_ref().map(|s| s.kind.as_str()).unwrap_or("direct");
    match kind {
        "cmd" => {
            let mut cmd = Command::new("cmd");
            hide_console(&mut cmd);
            cmd.arg("/C").arg(binary);
            for a in args {
                cmd.arg(a);
            }
            cmd
        }
        "powershell" => {
            let exe = shell
                .as_ref()
                .and_then(|s| s.path.as_deref())
                .map(str::trim)
                .filter(|p| !p.is_empty())
                .unwrap_or("powershell");
            powershell_command(exe, binary, args)
        }
        "custom" => {
            let path = shell
                .as_ref()
                .and_then(|s| s.path.as_deref())
                .map(str::trim)
                .filter(|p| !p.is_empty());
            match path {
                None => direct_command(binary, args),
                Some(path) => {
                    let lower = path.to_ascii_lowercase();
                    if lower.ends_with("powershell.exe")
                        || lower.ends_with("pwsh.exe")
                        || lower.ends_with("powershell")
                        || lower.ends_with("pwsh")
                    {
                        powershell_command(path, binary, args)
                    } else if lower.ends_with("cmd.exe") || lower.ends_with("cmd") {
                        let mut cmd = Command::new(path);
                        hide_console(&mut cmd);
                        cmd.arg("/C").arg(binary);
                        for a in args {
                            cmd.arg(a);
                        }
                        cmd
                    } else {
                        // Treat as a POSIX login shell: pass argv natively.
                        let mut cmd = Command::new(path);
                        hide_console(&mut cmd);
                        cmd.arg("-lc")
                            .arg(r#"exec "$@""#)
                            .arg("owf-shell")
                            .arg(binary);
                        for a in args {
                            cmd.arg(a);
                        }
                        cmd
                    }
                }
            }
        }
        _ => direct_command(binary, args),
    }
}

fn powershell_command(exe: &str, binary: &str, args: &[String]) -> Command {
    let mut cmd = Command::new(exe);
    hide_console(&mut cmd);
    let mut script = String::from("& ");
    script.push_str(&ps_quote(binary));
    for a in args {
        script.push(' ');
        script.push_str(&ps_quote(a));
    }
    cmd.arg("-NoProfile").arg("-Command").arg(script);
    cmd
}

/// Validate a user-selected *launch shell* path. Unlike `validate_cli_path`
/// this intentionally allows shells. Returns the normalized absolute path.
#[tauri::command]
fn validate_shell_path(path: String) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("请选择 Shell 可执行文件。".to_string());
    }
    let p = std::path::Path::new(trimmed);
    let canonical = std::fs::canonicalize(p)
        .map_err(|_| "找不到该文件，请重新选择。".to_string())?;
    if !canonical.is_file() {
        return Err("请选择一个可执行文件。".to_string());
    }
    Ok(canonical.to_string_lossy().to_string())
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let u = url.trim();
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err("invalid url".to_string());
    }
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", "start", "", u]);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(u);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(u);
        c
    };
    hide_console(&mut cmd);
    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn scan_model_clis() -> cli_runtime::CliScanResult {
    cli_runtime::scan_model_clis()
}

#[tauri::command]
fn validate_cli_path(path: String) -> Result<cli_runtime::CliPathValidation, String> {
    cli_runtime::validate_cli_path(&path)
}

/// Run an emitted workflow script through the mapped local CLI.
///
/// Async: the blocking process spawn/wait runs on a blocking thread via
/// `spawn_blocking` so it never stalls the webview's main thread (a synchronous
/// command would freeze the UI for the CLI's whole runtime). Spawns the real
/// binary (`claude` / `codex` / `gemini`), waits for it, and returns a combined
/// stdout/stderr summary. The script is materialised to a temp file.
#[tauri::command]
async fn run_workflow(
    script: String,
    adapter: String,
    cli_command: Option<String>,
    shell: Option<ShellSpec>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let binary = match cli_command
            .as_deref()
            .map(cli_runtime::normalize_cli_command_override)
            .transpose()?
        {
            Some(binary) => binary,
            None => cli_runtime::adapter_binary(&adapter).to_string(),
        };
        let script_path = write_temp_script(&script)?;

        // no popup terminal window on Windows; optionally wrapped in a shell.
        let args = vec![script_path.to_string_lossy().to_string()];
        let mut cmd = build_launch_command(&binary, &args, &shell);
        let output = cmd
            .output()
            .map_err(|e| format!("无法启动 CLI \"{binary}\"：请确认它已安装并在 PATH 中。({e})"))?;

        // Best-effort cleanup; ignore failures.
        let _ = std::fs::remove_file(&script_path);

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let code = output.status.code().unwrap_or(-1);

        let mut summary = String::new();
        summary.push_str(&format!("[{binary}] exit={code}\n"));
        if !stdout.trim().is_empty() {
            summary.push_str("--- stdout ---\n");
            summary.push_str(stdout.trim_end());
            summary.push('\n');
        }
        if !stderr.trim().is_empty() {
            summary.push_str("--- stderr ---\n");
            summary.push_str(stderr.trim_end());
            summary.push('\n');
        }

        if output.status.success() {
            Ok(summary)
        } else {
            Err(summary)
        }
    })
    .await
    .map_err(|e| format!("运行任务调度失败: {e}"))?
}

/// System prompt steering the model to emit a pure IRGraph JSON object that maps
/// onto a *runnable* Claude Code workflow (the injected-globals DSL).
const AI_EDIT_SYSTEM: &str = "You are a workflow graph editor for OpenWorkflows. You receive the current workflow as an IRGraph JSON object plus a natural-language instruction (in Chinese or English). Return ONLY a single valid IRGraph JSON object (no markdown, no prose).

The IRGraph compiles to a real Claude Code workflow script, so use these exact node shapes:
- Envelope: {version, meta, nodes, edges, layout?}.
- meta: {name, description?, adapter?, gateway?:{defaults?:{adapter, modelClass, providerId?, channelId?}}, schemaDefs?}. schemaDefs maps a schema identifier name to its JS object source, e.g. {\"REVIEW\":\"{ findings: [] }\"}.
- Each node: {id, type, parent?, label?, binding?, params}. type is one of start|end|agent|parallel|pipeline|phase|branch|loop|workflow|log|variable|codeblock. `parent` is the id of a containing branch/loop node (omit for the top level). `binding` is the JS variable name (optional).
- agent.params: {prompt, label?, agentType?, model?, gateway?, schema?, isolation?, phase?}. Use `agentType` (NOT `agent`) for a sub-agent type like 'explore'/'verifier'. `schema` is a bare identifier NAME (a key of meta.schemaDefs), e.g. \"REVIEW\". model is haiku|sonnet|opus. New nodes should inherit meta.gateway.defaults instead of writing model:'sonnet'.
- parallel.params: {branches: [{prompt, agentType?, model?, schema?, label?}]} — each branch becomes a () => agent(...) thunk.
- pipeline.params: {items, stages: [{prompt, agentType?, schema?}]} — items is a JS expression naming the input array (e.g. \"files\"); each stage becomes a (prev, item, i) => agent(...) callback.
- branch.params: {condition} and loop.params: {condition} (a JS boolean expression). Their child nodes are separate nodes carrying parent = the branch/loop id.
- variable.params: {name, value, raw?}. log.params: {message}. workflow.params: {name}. codeblock.params: {code}.

Before drafting, estimate the task's complexity from the instruction and the current graph. Match graph granularity to task complexity: use the smallest workflow that fully covers the request, keep simple edits minimal, and only expand into branches, pipelines, verification, fallback, or extra coordination when there are real dependencies, independent subproblems, or meaningful risk. Treat completeness as proportional to risk and ambiguity, not maximal by default.

Edges: {id, from:{node,port}, to:{node,port}, kind} where kind is 'exec' or 'data'. Wire an exec spine start -> ... -> end among top-level siblings; a branch/loop connects to its first child via an exec edge (kind 'exec') and children chain child->child. Express data flow as 'data'-kind edges from a producer node to a consumer node — do NOT inline ${...} yourself; the emitter does that. Keep node ids stable when editing existing nodes.";

/// Ask the Anthropic Messages API to rewrite the graph from an instruction.
///
/// Requires `api_key`. Returns the new IRGraph as a JSON string. When no key is
/// supplied the command errors so the frontend can fall back to its local
/// intent engine.
#[tauri::command]
fn ai_edit_graph(
    current_ir_json: String,
    instruction: String,
    api_key: Option<String>,
) -> Result<String, String> {
    let key = match api_key {
        Some(k) if !k.trim().is_empty() => k,
        _ => return Err("NO_API_KEY".to_string()),
    };

    let user_content = format!(
        "Current IRGraph:\n{current_ir_json}\n\nInstruction:\n{instruction}\n\nReturn the edited IRGraph JSON."
    );

    let body = serde_json::json!({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 8192,
        "system": AI_EDIT_SYSTEM,
        "messages": [
            { "role": "user", "content": user_content }
        ]
    });

    let response = ureq::post("https://api.anthropic.com/v1/messages")
        .set("x-api-key", &key)
        .set("anthropic-version", "2023-06-01")
        .set("content-type", "application/json")
        .send_json(body);

    let response = match response {
        Ok(r) => r,
        Err(ureq::Error::Status(code, resp)) => {
            let detail = resp
                .into_string()
                .unwrap_or_else(|_| "<no body>".to_string());
            return Err(format!("Anthropic API 错误 {code}: {detail}"));
        }
        Err(e) => return Err(format!("请求 Anthropic API 失败: {e}")),
    };

    let parsed: serde_json::Value = response
        .into_json()
        .map_err(|e| format!("解析 Anthropic 响应失败: {e}"))?;

    // Concatenate all text blocks from the content array.
    let text = parsed
        .get("content")
        .and_then(|c| c.as_array())
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();

    let trimmed = extract_json(&text);
    // Validate it parses as JSON before returning to the frontend.
    serde_json::from_str::<serde_json::Value>(&trimmed)
        .map_err(|e| format!("模型未返回有效 JSON: {e}\n原始输出:\n{text}"))?;

    Ok(trimmed)
}

/// Strip a possible ```json fence and return the inner JSON payload.
fn extract_json(text: &str) -> String {
    let t = text.trim();
    if let Some(rest) = t.strip_prefix("```json") {
        return rest.trim_end_matches("```").trim().to_string();
    }
    if let Some(rest) = t.strip_prefix("```") {
        return rest.trim_end_matches("```").trim().to_string();
    }
    t.to_string()
}

/// Default hard timeout for a single CLI invocation before it is killed.
const DEFAULT_AI_CLI_TIMEOUT_SECS: u64 = 1800;
/// Default "no observable progress" timeout for a single CLI invocation.
const DEFAULT_AI_CLI_IDLE_TIMEOUT_SECS: u64 = 300;
const CLI_ERROR_CONTEXT_LIMIT: usize = 1200;
/// Idle gap (no stdout activity) after which a "still running" heartbeat line is
/// emitted to the run log, so a long node never looks completely frozen even
/// during a long tool execution or a slow first token.
const AI_CLI_HEARTBEAT_SECS: u64 = 12;

/// Read the CLI timeout override from the environment, falling back to a
/// longer default so legitimate long-running workflows are less likely to be
/// killed too early.
fn configured_ai_cli_timeout_secs() -> u64 {
    std::env::var("OPENWORKFLOW_AI_CLI_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|secs| *secs >= 60)
        .unwrap_or(DEFAULT_AI_CLI_TIMEOUT_SECS)
}

fn ai_cli_timeout_secs(override_secs: Option<u64>) -> u64 {
    let configured = configured_ai_cli_timeout_secs();
    let dynamic = override_secs.filter(|secs| *secs >= 60).unwrap_or(configured);
    configured.max(dynamic)
}

/// Whether to load the machine's global MCP servers for each workflow node.
/// Off by default (each cold `claude -p` spawn skips MCP init, saving ~2-4s of
/// startup per node); set OPENWORKFLOW_ENABLE_MCP=1 to opt back in for
/// workflows whose nodes actually call an MCP tool.
fn mcp_enabled() -> bool {
    std::env::var("OPENWORKFLOW_ENABLE_MCP")
        .map(|v| {
            let v = v.trim().to_ascii_lowercase();
            v == "1" || v == "true" || v == "yes"
        })
        .unwrap_or(false)
}

/// Whether to request token-level partial streaming from the claude CLI via
/// `--include-partial-messages`. On by default so assistant text + extended
/// thinking stream as they are generated (matching the interactive CLI's live
/// feel); the plain `-p` stream otherwise emits only one event per *completed*
/// message, leaving the run log blank while a single long answer is composed.
/// Set OPENWORKFLOW_DISABLE_PARTIAL=1 if a CLI build predates the flag.
fn partial_enabled() -> bool {
    !std::env::var("OPENWORKFLOW_DISABLE_PARTIAL")
        .map(|v| {
            let v = v.trim().to_ascii_lowercase();
            v == "1" || v == "true" || v == "yes"
        })
        .unwrap_or(false)
}

/// Read the no-progress timeout override. Set to 0 to disable idle detection.
fn configured_ai_cli_idle_timeout_secs() -> u64 {
    std::env::var("OPENWORKFLOW_AI_CLI_IDLE_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|secs| *secs == 0 || *secs >= 30)
        .unwrap_or(DEFAULT_AI_CLI_IDLE_TIMEOUT_SECS)
}

fn ai_cli_idle_timeout_secs(override_secs: Option<u64>) -> u64 {
    let configured = configured_ai_cli_idle_timeout_secs();
    if configured == 0 {
        return 0;
    }
    match override_secs.filter(|secs| *secs == 0 || *secs >= 30) {
        Some(0) => 0,
        Some(dynamic) => configured.max(dynamic),
        None => configured,
    }
}

fn touch_activity(last_activity: &Arc<Mutex<std::time::Instant>>) {
    if let Ok(mut current) = last_activity.lock() {
        *current = std::time::Instant::now();
    }
}

fn activity_elapsed(last_activity: &Arc<Mutex<std::time::Instant>>) -> std::time::Duration {
    last_activity
        .lock()
        .map(|current| current.elapsed())
        .unwrap_or_default()
}

fn trim_cli_error_context(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= CLI_ERROR_CONTEXT_LIMIT {
        return trimmed.to_string();
    }
    let mut tail = trimmed
        .chars()
        .rev()
        .take(CLI_ERROR_CONTEXT_LIMIT)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    tail.insert_str(0, "...\n");
    tail
}

fn append_cli_error_context(err: String, output: &str, stderr: &str) -> String {
    let context = if !stderr.trim().is_empty() {
        stderr
    } else {
        output
    };
    let context = trim_cli_error_context(context);
    if context.is_empty() {
        err
    } else {
        format!("{err}\n最近输出:\n{context}")
    }
}

/// Emit a live progress chunk for a given run to the frontend.
fn emit_progress(app: &tauri::AppHandle, run_id: &str, text: &str) {
    let _ = app.emit(
        "ai-cli-progress",
        serde_json::json!({ "runId": run_id, "text": text }),
    );
}

/// Summarize a `tool_use` event into one readable progress line, e.g.
/// `🔧 Bash: ls app/src` / `🔧 Glob: **/*.tsx` / `🔧 Read: app/src/core/ir.ts`,
/// so the run log shows *what* the agent is doing, not just the tool name.
fn summarize_tool_use(name: &str, input: &serde_json::Value) -> String {
    // Prefer the most informative known field; fall back to compact JSON.
    let detail = [
        "command",
        "pattern",
        "file_path",
        "path",
        "query",
        "url",
        "description",
        "prompt",
        "old_string",
        "title",
    ]
    .iter()
    .find_map(|k| {
        input
            .get(*k)
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
    })
    .unwrap_or_else(|| {
        let s = input.to_string();
        if s == "null" {
            String::new()
        } else {
            s
        }
    });

    let detail: String = detail.replace(['\n', '\r'], " ");
    let detail: String = detail.chars().take(200).collect();
    if detail.is_empty() {
        format!("🔧 {name}")
    } else {
        format!("🔧 {name}: {detail}")
    }
}

/// Summarize a `tool_result` block (the `user`-role event that carries a tool's
/// output) into one short, single-line breadcrumb, e.g. `app/src/core/ir.ts …`.
/// `content` may be a bare string or an array of `{type:"text",text}` blocks.
/// Returns an empty string when there is nothing useful to show.
fn summarize_tool_result(block: &serde_json::Value) -> String {
    let raw = match block.get("content") {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(arr)) => arr
            .iter()
            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join(" "),
        _ => String::new(),
    };
    let one_line = raw.replace(['\n', '\r'], " ");
    let truncated: String = one_line.trim().chars().take(160).collect();
    if truncated.is_empty() {
        return String::new();
    }
    if block.get("is_error").and_then(|b| b.as_bool()).unwrap_or(false) {
        format!("⚠ {truncated}")
    } else {
        truncated
    }
}

/// Codex CLI JSONL uses `item.completed` events rather than Claude's
/// `assistant` / `result` events. Emit readable agent text and a compact tool
/// breadcrumb when a tool-like item appears.
fn codex_progress_line(item: &serde_json::Value) -> Option<String> {
    let item_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if item_type == "agent_message" {
        return item
            .get("text")
            .and_then(|t| t.as_str())
            .filter(|t| !t.is_empty())
            .map(|t| t.to_string());
    }

    if item_type.is_empty() {
        return None;
    }

    let detail = [
        "command",
        "name",
        "path",
        "file_path",
        "query",
        "text",
        "status",
    ]
    .iter()
    .find_map(|k| {
        item.get(*k)
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.replace(['\n', '\r'], " "))
    })
    .unwrap_or_default();

    let detail: String = detail.chars().take(200).collect();
    if detail.is_empty() {
        Some(format!("\n🔧 {item_type}\n"))
    } else {
        Some(format!("\n🔧 {item_type}: {detail}\n"))
    }
}

fn codex_event_kind(event: &serde_json::Value) -> Option<&str> {
    event
        .get("method")
        .and_then(|m| m.as_str())
        .or_else(|| event.get("type").and_then(|t| t.as_str()))
}

fn codex_completed_item(event: &serde_json::Value) -> Option<&serde_json::Value> {
    match codex_event_kind(event) {
        Some("item.completed") | Some("item/completed") => {
            event.get("item").or_else(|| event.pointer("/params/item"))
        }
        _ => None,
    }
}

fn codex_turn_completion_status(event: &serde_json::Value) -> Option<String> {
    match codex_event_kind(event) {
        Some("turn.completed") | Some("turn/completed") | Some("turn_complete") => {
            let status = event
                .pointer("/params/turn/status")
                .or_else(|| event.pointer("/turn/status"))
                .or_else(|| event.get("status"))
                .and_then(|s| s.as_str())
                .unwrap_or("completed");
            Some(status.to_string())
        }
        _ => None,
    }
}

fn codex_status_success(status: &str) -> bool {
    matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "completed" | "success" | "succeeded" | "ok"
    )
}

fn codex_last_message_ready(path: &std::path::Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if meta.len() == 0 {
        return false;
    }
    meta.modified()
        .and_then(|modified| modified.elapsed().map_err(std::io::Error::other))
        .map(|elapsed| elapsed >= std::time::Duration::from_secs(1))
        .unwrap_or(false)
}

/// The UI currently exposes Claude model tiers (`haiku` / `sonnet` / `opus`).
/// Passing those through to Codex would fail, so only forward explicit non-
#[tauri::command]
fn cancel_ai_cli(run_id: String) -> Result<(), String> {
    if let Some(pid) = mark_ai_cli_cancelled(&run_id) {
        let _ = terminate_process_tree(pid);
    }
    Ok(())
}

/// Run a prompt through the locally-installed agent CLI (e.g. `claude`) using the
/// machine's own environment/credentials — no API key is passed from the app.
///
/// Uses `claude -p "<prompt>" --output-format stream-json --verbose
/// --include-partial-messages` so that:
///   - token-level partial deltas (assistant text + extended thinking), tool
///     uses, tool results (with durations) and the opening `init` event all
///     stream to the frontend via the `ai-cli-progress` event (tagged with
///     `run_id`) — the run no longer looks frozen while a node is working; a
///     "still running" heartbeat covers any remaining silent gap; and
///   - the clean final answer is taken from the terminal `result` event.
/// The optional `model` maps the node's model tier (haiku/sonnet/opus) onto
/// `--model`. stdin is closed; the call is bounded by a timeout that kills the
/// child so a stuck CLI surfaces an error instead of hanging "运行中" forever.
#[tauri::command]
async fn ai_cli(
    prompt: String,
    adapter: String,
    cli_command: Option<String>,
    model: Option<String>,
    cwd: Option<String>,
    permission: Option<String>,
    env_vars: Option<HashMap<String, String>>,
    timeout_seconds: Option<u64>,
    idle_timeout_seconds: Option<u64>,
    run_id: String,
    // Optional Claude session continuity (claude only): when `session_id` is set
    // and `resume` is false the run *creates* that session (`--session-id`); when
    // `resume` is true it *continues* it (`--resume`), inheriting the prior
    // call's full context so a downstream step needn't re-explore the project.
    session_id: Option<String>,
    resume: Option<bool>,
    // Optional launch shell wrapping (from the General settings "启动 Shell").
    shell: Option<ShellSpec>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let binary = match cli_command
            .as_deref()
            .map(cli_runtime::normalize_cli_command_override)
            .transpose()?
        {
            Some(binary) => binary,
            None => cli_runtime::adapter_binary(&adapter).to_string(),
        };
        let protocol = cli_runtime::adapter_protocol(&adapter);
        let is_codex = protocol == "codex";
        let codex_last_message_path = if is_codex {
            Some(temp_output_path("openworkflow-codex-last", "txt"))
        } else {
            None
        };

        // Self-heal a claude binary that an interrupted auto-update corrupted.
        if protocol == "claude" {
            repair_claude_binary();
        }

        // Collect the program arguments first so the whole invocation can be
        // optionally wrapped in a launch shell (see build_launch_command). Env
        // vars and the working directory are applied to the final (outer)
        // command below and inherited by any wrapped child.
        let mut args: Vec<String> = Vec::new();
        let mut workdir: Option<std::path::PathBuf> = None;
        let mut disable_autoupdater = false;

        if is_codex {
            // Codex's non-interactive surface is `codex exec`, and its JSON
            // stream is enabled with `--json`. It has no Claude-style
            // `--output-format`, which was the source of the reported failure.
            match permission.as_deref().unwrap_or("full") {
                "readonly" => {
                    args.push("-a".into());
                    args.push("never".into());
                }
                "ask" => {
                    args.push("-a".into());
                    args.push("on-request".into());
                }
                _ => {}
            }

            args.push("exec".into());
            args.push("--json".into());
            args.push("--skip-git-repo-check".into());

            match permission.as_deref().unwrap_or("full") {
                "readonly" => {
                    args.push("--sandbox".into());
                    args.push("read-only".into());
                }
                "ask" => {
                    args.push("--sandbox".into());
                    args.push("workspace-write".into());
                }
                _ => {
                    args.push("--dangerously-bypass-approvals-and-sandbox".into());
                }
            }

            if let Some(m) = model.as_deref().filter(|m| cli_runtime::should_pass_model(&adapter, m)) {
                args.push("--model".into());
                args.push(m.to_string());
            }

            if let Some(dir) = cwd.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
                let p = std::path::Path::new(dir);
                if p.is_dir() {
                    workdir = Some(p.to_path_buf());
                    args.push("-C".into());
                    args.push(dir.to_string());
                }
            }

            if let Some(path) = codex_last_message_path.as_ref() {
                args.push("-o".into());
                args.push(path.to_string_lossy().to_string());
            }
            args.push("-".into());
        } else {
            // The prompt is fed via stdin (not a positional arg) so large
            // aggregation prompts can't hit the OS command-line length limit
            // (~32KB on Windows), which would stall the final "summary" node.
            args.push("-p".into());
            args.push("--output-format".into());
            args.push("stream-json".into());
            args.push("--verbose".into());
            // Token-level streaming so the run log fills in as text/thinking is
            // generated, instead of staying blank until a whole message lands.
            if partial_enabled() {
                args.push("--include-partial-messages".into());
            }
            // Don't let the CLI auto-update mid-run: an interrupted update can
            // leave the binary corrupted ("bin executable does not exist").
            disable_autoupdater = true;

            // Skip loading the machine's global MCP servers for each node. A
            // workflow node is a short, bounded task that almost never needs
            // pencil/lark/etc., yet initialising every configured MCP server
            // costs ~2-4s of cold-start *per node* (measured) — paid N times
            // for an N-node run, while a single interactive session pays it
            // once. `--strict-mcp-config` with no `--mcp-config` means "use
            // only servers from the (absent) config", i.e. none. Opt back in
            // with OPENWORKFLOW_ENABLE_MCP=1 for workflows that genuinely call
            // an MCP tool.
            if !mcp_enabled() {
                args.push("--strict-mcp-config".into());
            }

            // Session continuity: continue a prior session (warm context) or
            // create a known one so a later step can continue it.
            if let Some(sid) = session_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                if resume.unwrap_or(false) {
                    args.push("--resume".into());
                    args.push(sid.to_string());
                } else {
                    args.push("--session-id".into());
                    args.push(sid.to_string());
                }
            }
            if let Some(m) = model.as_deref().filter(|m| cli_runtime::should_pass_model(&adapter, m)) {
                args.push("--model".into());
                args.push(m.to_string());
            }

            // Permission mode (from the AIDock dropdown) so a headless run can
            // act without stalling on permission prompts:
            //   full      -> skip all prompts (read/write/bash autonomously)
            //   readonly  -> plan mode (explore + report, no mutations)
            //   ask       -> default (may print a permission question)
            match permission.as_deref().unwrap_or("full") {
                "readonly" => {
                    args.push("--permission-mode".into());
                    args.push("plan".into());
                }
                "ask" => {}
                _ => {
                    args.push("--dangerously-skip-permissions".into());
                }
            }

            // Working directory: run in the user's chosen workspace so the
            // agent explores the right project (and add it as an allowed dir).
            if let Some(dir) = cwd.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
                let p = std::path::Path::new(dir);
                if p.is_dir() {
                    workdir = Some(p.to_path_buf());
                    args.push("--add-dir".into());
                    args.push(dir.to_string());
                }
            }
        }

        let mut cmd = build_launch_command(&binary, &args, &shell);
        if let Some(env_vars) = env_vars.as_ref() {
            for (key, value) in env_vars {
                if !key.trim().is_empty() {
                    cmd.env(key, value);
                }
            }
        }
        if disable_autoupdater {
            cmd.env("DISABLE_AUTOUPDATER", "1");
        }
        if let Some(dir) = workdir.as_ref() {
            cmd.current_dir(dir);
        }

        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                format!("无法启动 CLI \"{binary}\"：请确认它已安装并在 PATH 中。({e})")
            })?;
        register_ai_cli(&run_id, child.id());
        let last_activity = Arc::new(Mutex::new(std::time::Instant::now()));

        // Write the prompt to stdin on its own thread (so a large prompt can't
        // deadlock against a full pipe), then close stdin to signal EOF.
        let mut stdin_pipe = child.stdin.take();
        let prompt_bytes = prompt.into_bytes();
        let stdin_handle = std::thread::spawn(move || {
            if let Some(mut s) = stdin_pipe.take() {
                let _ = s.write_all(&prompt_bytes);
            }
        });

        // Reader thread: parse the JSONL stream, emit progress, capture the result.
        let stdout = child.stdout.take();
        let app2 = app.clone();
        let run2 = run_id.clone();
        let parse_codex = is_codex;
        let codex_turn_status = Arc::new(Mutex::new(None::<String>));
        let codex_turn_status_reader = Arc::clone(&codex_turn_status);
        let stdout_activity = Arc::clone(&last_activity);
        let partial_streaming = partial_enabled();
        let out_handle = std::thread::spawn(move || -> String {
            let mut result = String::new();
            let mut acc = String::new();
            // `prev_kind` tracks the last delta kind ("text" / "thinking") so we
            // can insert a separator when the model switches between them.
            let mut prev_kind: &str = "";
            // tool_use id → start time, so a tool_result can report its duration.
            let mut tool_starts: HashMap<String, std::time::Instant> = HashMap::new();
            let mut init_done = false;
            if let Some(o) = stdout {
                let reader = std::io::BufReader::new(o);
                for line in reader.lines() {
                    let line = match line {
                        Ok(l) => l,
                        Err(_) => break,
                    };
                    touch_activity(&stdout_activity);
                    if line.trim().is_empty() {
                        continue;
                    }
                    let v: serde_json::Value = match serde_json::from_str(&line) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    if parse_codex {
                        if let Some(status) = codex_turn_completion_status(&v) {
                            if let Ok(mut current) = codex_turn_status_reader.lock() {
                                *current = Some(status);
                            }
                            continue;
                        }
                        if let Some(item) = codex_completed_item(&v) {
                            if let Some(line) = codex_progress_line(item) {
                                acc.push_str(&line);
                                emit_progress(&app2, &run2, &line);
                            }
                        }
                        continue;
                    }
                    match v.get("type").and_then(|t| t.as_str()) {
                        Some("system") => {
                            // The opening `init` event is the first "I'm alive"
                            // signal — surface it so cold-start latency isn't blank.
                            if !init_done
                                && v.get("subtype").and_then(|s| s.as_str()) == Some("init")
                            {
                                init_done = true;
                                let model =
                                    v.get("model").and_then(|m| m.as_str()).unwrap_or("");
                                let line = if model.is_empty() {
                                    "⚙ 会话已启动，开始处理…".to_string()
                                } else {
                                    format!("⚙ 会话已启动（{model}），开始处理…")
                                };
                                emit_progress(&app2, &run2, &format!("{line}\n"));
                            }
                        }
                        Some("stream_event") => {
                            // Token-level partial deltas: live display ONLY. The
                            // authoritative text is still captured from the complete
                            // `assistant` / `result` events below, so we never push
                            // a partial chunk into `acc` (that would double-count).
                            if let Some(ev) = v.get("event") {
                                let ev_type =
                                    ev.get("type").and_then(|t| t.as_str()).unwrap_or("");
                                if ev_type == "content_block_delta" {
                                    if let Some(delta) = ev.get("delta") {
                                        match delta.get("type").and_then(|t| t.as_str()) {
                                            Some("text_delta") => {
                                                if let Some(tx) =
                                                    delta.get("text").and_then(|t| t.as_str())
                                                {
                                                    if prev_kind == "thinking" {
                                                        emit_progress(&app2, &run2, "\n");
                                                    }
                                                    prev_kind = "text";
                                                    emit_progress(&app2, &run2, tx);
                                                }
                                            }
                                            Some("thinking_delta") => {
                                                if let Some(tx) = delta
                                                    .get("thinking")
                                                    .and_then(|t| t.as_str())
                                                {
                                                    if prev_kind != "thinking" {
                                                        emit_progress(
                                                            &app2, &run2, "\n💭 思考：",
                                                        );
                                                    }
                                                    prev_kind = "thinking";
                                                    emit_progress(&app2, &run2, tx);
                                                }
                                            }
                                            _ => {}
                                        }
                                    }
                                }
                            }
                        }
                        Some("assistant") => {
                            if let Some(content) =
                                v.pointer("/message/content").and_then(|c| c.as_array())
                            {
                                for block in content {
                                    match block.get("type").and_then(|t| t.as_str()) {
                                        Some("text") => {
                                            if let Some(tx) =
                                                block.get("text").and_then(|t| t.as_str())
                                            {
                                                // Capture for the fallback return
                                                // value. When partial streaming is on
                                                // it was already shown live via deltas,
                                                // so don't re-emit (avoids duplication).
                                                acc.push_str(tx);
                                                if !partial_streaming {
                                                    emit_progress(&app2, &run2, tx);
                                                }
                                            }
                                        }
                                        Some("tool_use") => {
                                            let name = block
                                                .get("name")
                                                .and_then(|t| t.as_str())
                                                .unwrap_or("tool");
                                            let input = block
                                                .get("input")
                                                .cloned()
                                                .unwrap_or(serde_json::Value::Null);
                                            if let Some(id) =
                                                block.get("id").and_then(|t| t.as_str())
                                            {
                                                tool_starts.insert(
                                                    id.to_string(),
                                                    std::time::Instant::now(),
                                                );
                                            }
                                            prev_kind = "";
                                            emit_progress(
                                                &app2,
                                                &run2,
                                                &format!(
                                                    "\n{}\n",
                                                    summarize_tool_use(name, &input)
                                                ),
                                            );
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        }
                        Some("user") => {
                            // Tool results arrive as a `user`-role message. Show a
                            // truncated breadcrumb + the tool's wall-clock duration so
                            // a long Bash/Read/test is no longer a silent gap.
                            if let Some(content) =
                                v.pointer("/message/content").and_then(|c| c.as_array())
                            {
                                for block in content {
                                    if block.get("type").and_then(|t| t.as_str())
                                        != Some("tool_result")
                                    {
                                        continue;
                                    }
                                    let dur = block
                                        .get("tool_use_id")
                                        .and_then(|t| t.as_str())
                                        .and_then(|id| tool_starts.remove(id))
                                        .map(|start| start.elapsed().as_secs());
                                    let head = match dur {
                                        Some(s) => format!("✓ 工具完成（{s}s）"),
                                        None => "✓ 工具完成".to_string(),
                                    };
                                    let summary = summarize_tool_result(block);
                                    prev_kind = "";
                                    if summary.is_empty() {
                                        emit_progress(&app2, &run2, &format!("{head}\n"));
                                    } else {
                                        emit_progress(
                                            &app2,
                                            &run2,
                                            &format!("{head}: {summary}\n"),
                                        );
                                    }
                                }
                            }
                        }
                        Some("result") => {
                            if let Some(r) = v.get("result").and_then(|t| t.as_str()) {
                                result = r.to_string();
                            }
                        }
                        _ => {}
                    }
                }
            }
            if result.trim().is_empty() {
                acc
            } else {
                result
            }
        });

        let mut err_pipe = child.stderr.take();
        let stderr_activity = Arc::clone(&last_activity);
        let err_handle = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(p) = err_pipe.as_mut() {
                let mut chunk = [0_u8; 4096];
                loop {
                    match p.read(&mut chunk) {
                        Ok(0) => break,
                        Ok(n) => {
                            touch_activity(&stderr_activity);
                            buf.extend_from_slice(&chunk[..n]);
                        }
                        Err(_) => break,
                    }
                }
            }
            buf
        });

        // Poll for exit until the deadline; kill on timeout. Even timeout and
        // wait-error paths fall through to the common cleanup below so reader
        // threads finish and Codex side-channel files do not linger in temp.
        enum WaitOutcome {
            Exited(std::process::ExitStatus),
            CodexTurnCompleted(String),
            CodexLastMessageReady,
        }

        let timeout_secs = ai_cli_timeout_secs(timeout_seconds);
        let idle_timeout_secs = ai_cli_idle_timeout_secs(idle_timeout_seconds);
        let idle_timeout = (idle_timeout_secs > 0)
            .then(|| std::time::Duration::from_secs(idle_timeout_secs));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);
        let mut last_sidecar_len = 0_u64;
        let mut last_sidecar_modified: Option<std::time::SystemTime> = None;
        let run_started_at = std::time::Instant::now();
        let mut last_heartbeat = run_started_at;
        let wait_result = loop {
            if is_codex {
                let status = codex_turn_status
                    .lock()
                    .ok()
                    .and_then(|current| current.clone());
                if let Some(status) = status {
                    terminate_child_tree(&mut child);
                    break Ok(WaitOutcome::CodexTurnCompleted(status));
                }
                if let Some(path) = codex_last_message_path.as_deref() {
                    if let Ok(meta) = std::fs::metadata(path) {
                        let modified = meta.modified().ok();
                        if meta.len() != last_sidecar_len || modified != last_sidecar_modified {
                            last_sidecar_len = meta.len();
                            last_sidecar_modified = modified;
                            touch_activity(&last_activity);
                        }
                    }
                }
                if codex_last_message_path
                    .as_deref()
                    .is_some_and(codex_last_message_ready)
                {
                    terminate_child_tree(&mut child);
                    break Ok(WaitOutcome::CodexLastMessageReady);
                }
            }
            match child.try_wait() {
                Ok(Some(status)) => break Ok(WaitOutcome::Exited(status)),
                Ok(None) => {
                    if std::time::Instant::now() >= deadline {
                        terminate_child_tree(&mut child);
                        break Err(format!("CLI \"{binary}\" 超时（{timeout_secs}s）已终止。"));
                    }
                    if let Some(idle) = idle_timeout {
                        if activity_elapsed(&last_activity) >= idle {
                            terminate_child_tree(&mut child);
                            break Err(format!(
                                "CLI \"{binary}\" 空转超过 {idle_timeout_secs}s 未产生输出，已终止。"
                            ));
                        }
                    }
                    // Heartbeat: during a silent gap (slow first token, long tool
                    // run, extended thinking with partial streaming off), drop a
                    // "still running" line so the node never looks frozen. Reads
                    // activity only — must NOT touch it, or idle detection breaks.
                    if !is_codex {
                        let beat = std::time::Duration::from_secs(AI_CLI_HEARTBEAT_SECS);
                        let now = std::time::Instant::now();
                        if activity_elapsed(&last_activity) >= beat
                            && now.duration_since(last_heartbeat) >= beat
                        {
                            let total = run_started_at.elapsed().as_secs();
                            emit_progress(&app, &run_id, &format!("\n⏳ 仍在运行…（已 {total}s）\n"));
                            last_heartbeat = now;
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                Err(e) => {
                    terminate_child_tree(&mut child);
                    break Err(format!("等待 CLI \"{binary}\" 失败: {e}"));
                }
            }
        };

        let _ = stdin_handle.join();
        let streamed_output = out_handle.join().unwrap_or_default();
        let output = if let Some(path) = codex_last_message_path.as_ref() {
            let final_message = std::fs::read_to_string(path).unwrap_or_default();
            let _ = std::fs::remove_file(path);
            if final_message.trim().is_empty() {
                streamed_output
            } else {
                final_message
            }
        } else {
            streamed_output
        };
        let stderr_bytes = err_handle.join().unwrap_or_default();
        let stderr = String::from_utf8_lossy(&stderr_bytes);
        let cancelled = take_ai_cli_cancelled(&run_id);
        unregister_ai_cli(&run_id);

        if cancelled {
            return Err(append_cli_error_context(
                format!("CLI \"{binary}\" 已由用户中断。"),
                &output,
                &stderr,
            ));
        }

        match wait_result {
            Err(err) => Err(append_cli_error_context(err, &output, &stderr)),
            Ok(WaitOutcome::Exited(status)) if status.success() => Ok(output),
            Ok(WaitOutcome::Exited(status)) => {
                let code = status.code().unwrap_or(-1);
                let detail = if stderr.trim().is_empty() {
                    output.trim()
                } else {
                    stderr.trim()
                };
                Err(format!("CLI \"{binary}\" 退出码 {code}: {detail}"))
            }
            Ok(WaitOutcome::CodexTurnCompleted(status)) if codex_status_success(&status) => {
                Ok(output)
            }
            Ok(WaitOutcome::CodexTurnCompleted(status)) => {
                let detail = if stderr.trim().is_empty() {
                    output.trim()
                } else {
                    stderr.trim()
                };
                Err(format!("CLI \"{binary}\" turn status {status}: {detail}"))
            }
            Ok(WaitOutcome::CodexLastMessageReady) => Ok(output),
        }
    })
    .await
    .map_err(|e| format!("CLI 任务调度失败: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarizes_tool_result_variants() {
        // String content.
        let s = serde_json::json!({ "type": "tool_result", "content": "hello\nworld" });
        assert_eq!(summarize_tool_result(&s), "hello world");

        // Array-of-text-blocks content.
        let arr = serde_json::json!({
            "type": "tool_result",
            "content": [{ "type": "text", "text": "line one" }, { "type": "text", "text": "line two" }]
        });
        assert_eq!(summarize_tool_result(&arr), "line one line two");

        // Error results are prefixed.
        let err = serde_json::json!({
            "type": "tool_result", "is_error": true, "content": "boom"
        });
        assert_eq!(summarize_tool_result(&err), "⚠ boom");

        // Empty / missing content yields an empty breadcrumb.
        let empty = serde_json::json!({ "type": "tool_result", "content": "   " });
        assert_eq!(summarize_tool_result(&empty), "");

        // Long output is truncated to 160 chars.
        let long = "x".repeat(300);
        let big = serde_json::json!({ "type": "tool_result", "content": long });
        assert_eq!(summarize_tool_result(&big).chars().count(), 160);
    }

    #[test]
    fn parses_codex_type_events() {
        let item = serde_json::json!({
            "type": "item.completed",
            "item": { "type": "agent_message", "text": "done" }
        });
        assert_eq!(
            codex_completed_item(&item)
                .and_then(|v| v.get("text"))
                .and_then(|v| v.as_str()),
            Some("done")
        );

        let turn = serde_json::json!({
            "type": "turn.completed",
            "status": "completed"
        });
        assert_eq!(
            codex_turn_completion_status(&turn).as_deref(),
            Some("completed")
        );
    }

    #[test]
    fn parses_codex_method_events() {
        let item = serde_json::json!({
            "method": "item/completed",
            "params": { "item": { "type": "command_execution", "command": "npm test" } }
        });
        assert_eq!(
            codex_completed_item(&item)
                .and_then(|v| v.get("command"))
                .and_then(|v| v.as_str()),
            Some("npm test")
        );

        let turn = serde_json::json!({
            "method": "turn/completed",
            "params": { "turn": { "status": "completed" } }
        });
        assert_eq!(
            codex_turn_completion_status(&turn).as_deref(),
            Some("completed")
        );
    }

    #[test]
    fn trims_cli_error_context_from_tail() {
        let text = "x".repeat(CLI_ERROR_CONTEXT_LIMIT + 32);
        let trimmed = trim_cli_error_context(&text);
        assert!(trimmed.starts_with("...\n"));
        assert!(trimmed.len() < text.len());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ai_edit_graph,
            run_workflow,
            ai_cli,
            cancel_ai_cli,
            scan_model_clis,
            validate_cli_path,
            validate_shell_path,
            open_external,
            history::history_root,
            history::history_read_json,
            history::history_write_json,
            history::history_remove,
            history::history_list_dir,
            cc_switch_import::import_cc_switch_claude
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
