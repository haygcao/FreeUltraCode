use std::collections::{HashMap, HashSet};
use std::io::{BufRead, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::Emitter;

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
fn adapter_binary(adapter: &str) -> &str {
    match adapter {
        "claude-code" | "claude" => "claude",
        "codex" => "codex",
        "gemini" => "gemini",
        other => other,
    }
}

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

/// Run an emitted workflow script through the mapped local CLI.
///
/// Async: the blocking process spawn/wait runs on a blocking thread via
/// `spawn_blocking` so it never stalls the webview's main thread (a synchronous
/// command would freeze the UI for the CLI's whole runtime). Spawns the real
/// binary (`claude` / `codex` / `gemini`), waits for it, and returns a combined
/// stdout/stderr summary. The script is materialised to a temp file.
#[tauri::command]
async fn run_workflow(script: String, adapter: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let binary = adapter_binary(&adapter);
        let script_path = write_temp_script(&script)?;

        let mut cmd = Command::new(binary);
        hide_console(&mut cmd); // no popup terminal window on Windows
        let output = cmd.arg(&script_path).output().map_err(|e| {
            format!("启动 CLI \"{binary}\" 失败: {e}（请确认它已安装并在 PATH 中）")
        })?;

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
const AI_EDIT_SYSTEM: &str = "You are a workflow graph editor for OpenWorkflow. You receive the current workflow as an IRGraph JSON object plus a natural-language instruction (in Chinese or English). Return ONLY a single valid IRGraph JSON object (no markdown, no prose).

The IRGraph compiles to a real Claude Code workflow script, so use these exact node shapes:
- Envelope: {version, meta, nodes, edges, layout?}.
- meta: {name, description?, adapter?, schemaDefs?}. schemaDefs maps a schema identifier name to its JS object source, e.g. {\"REVIEW\":\"{ findings: [] }\"}.
- Each node: {id, type, parent?, label?, binding?, params}. type is one of start|end|agent|parallel|pipeline|phase|branch|loop|workflow|log|variable|codeblock. `parent` is the id of a containing branch/loop node (omit for the top level). `binding` is the JS variable name (optional).
- agent.params: {prompt, label?, agentType?, model?, schema?, isolation?, phase?}. Use `agentType` (NOT `agent`) for a sub-agent type like 'explore'/'verifier'. `schema` is a bare identifier NAME (a key of meta.schemaDefs), e.g. \"REVIEW\". model is haiku|sonnet|opus.
- parallel.params: {branches: [{prompt, agentType?, model?, schema?, label?}]} — each branch becomes a () => agent(...) thunk.
- pipeline.params: {items, stages: [{prompt, agentType?, schema?}]} — items is a JS expression naming the input array (e.g. \"files\"); each stage becomes a (prev, item, i) => agent(...) callback.
- branch.params: {condition} and loop.params: {condition} (a JS boolean expression). Their child nodes are separate nodes carrying parent = the branch/loop id.
- variable.params: {name, value, raw?}. log.params: {message}. workflow.params: {name}. codeblock.params: {code}.

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

/// Read the CLI timeout override from the environment, falling back to a
/// longer default so legitimate long-running workflows are less likely to be
/// killed too early.
fn ai_cli_timeout_secs() -> u64 {
    std::env::var("OPENWORKFLOW_AI_CLI_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|secs| *secs >= 60)
        .unwrap_or(DEFAULT_AI_CLI_TIMEOUT_SECS)
}

/// Read the no-progress timeout override. Set to 0 to disable idle detection.
fn ai_cli_idle_timeout_secs() -> u64 {
    std::env::var("OPENWORKFLOW_AI_CLI_IDLE_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|secs| *secs == 0 || *secs >= 30)
        .unwrap_or(DEFAULT_AI_CLI_IDLE_TIMEOUT_SECS)
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
/// Claude model ids to adapters that can reasonably understand them.
fn should_pass_model(binary: &str, model: &str) -> bool {
    let m = model.trim();
    if m.is_empty() {
        return false;
    }
    if binary == "codex" || binary == "gemini" {
        let lower = m.to_ascii_lowercase();
        return !matches!(lower.as_str(), "haiku" | "sonnet" | "opus")
            && !lower.starts_with("claude-");
    }
    true
}

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
/// Uses `claude -p "<prompt>" --output-format stream-json --verbose` so that:
///   - per-step events (assistant text, tool uses) stream to the frontend via the
///     `ai-cli-progress` event (tagged with `run_id`) — the run no longer looks
///     frozen while a node's agent is exploring the project; and
///   - the clean final answer is taken from the terminal `result` event.
/// The optional `model` maps the node's model tier (haiku/sonnet/opus) onto
/// `--model`. stdin is closed; the call is bounded by a timeout that kills the
/// child so a stuck CLI surfaces an error instead of hanging "运行中" forever.
#[tauri::command]
async fn ai_cli(
    prompt: String,
    adapter: String,
    model: Option<String>,
    cwd: Option<String>,
    permission: Option<String>,
    run_id: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let binary = adapter_binary(&adapter);
        let is_codex = binary == "codex";
        let codex_last_message_path = if is_codex {
            Some(temp_output_path("openworkflow-codex-last", "txt"))
        } else {
            None
        };

        // Self-heal a claude binary that an interrupted auto-update corrupted.
        if binary == "claude" {
            repair_claude_binary();
        }

        let mut cmd = Command::new(binary);
        hide_console(&mut cmd); // no popup terminal window on Windows

        if is_codex {
            // Codex's non-interactive surface is `codex exec`, and its JSON
            // stream is enabled with `--json`. It has no Claude-style
            // `--output-format`, which was the source of the reported failure.
            match permission.as_deref().unwrap_or("full") {
                "readonly" => {
                    cmd.arg("-a").arg("never");
                }
                "ask" => {
                    cmd.arg("-a").arg("on-request");
                }
                _ => {}
            }

            cmd.arg("exec").arg("--json").arg("--skip-git-repo-check");

            match permission.as_deref().unwrap_or("full") {
                "readonly" => {
                    cmd.arg("--sandbox").arg("read-only");
                }
                "ask" => {
                    cmd.arg("--sandbox").arg("workspace-write");
                }
                _ => {
                    cmd.arg("--dangerously-bypass-approvals-and-sandbox");
                }
            }

            if let Some(m) = model.as_deref().filter(|m| should_pass_model(binary, m)) {
                cmd.arg("--model").arg(m);
            }

            if let Some(dir) = cwd.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
                let p = std::path::Path::new(dir);
                if p.is_dir() {
                    cmd.current_dir(p);
                    cmd.arg("-C").arg(dir);
                }
            }

            if let Some(path) = codex_last_message_path.as_ref() {
                cmd.arg("-o").arg(path);
            }
            cmd.arg("-");
        } else {
            // The prompt is fed via stdin (not a positional arg) so large
            // aggregation prompts can't hit the OS command-line length limit
            // (~32KB on Windows), which would stall the final "summary" node.
            cmd.arg("-p")
                .arg("--output-format")
                .arg("stream-json")
                .arg("--verbose")
                // Don't let the CLI auto-update mid-run: an interrupted update
                // can leave the binary corrupted ("bin executable does not
                // exist").
                .env("DISABLE_AUTOUPDATER", "1");
            if let Some(m) = model.as_deref().filter(|m| should_pass_model(binary, m)) {
                cmd.arg("--model").arg(m);
            }

            // Permission mode (from the AIDock dropdown) so a headless run can
            // act without stalling on permission prompts:
            //   full      -> skip all prompts (read/write/bash autonomously)
            //   readonly  -> plan mode (explore + report, no mutations)
            //   ask       -> default (may print a permission question)
            match permission.as_deref().unwrap_or("full") {
                "readonly" => {
                    cmd.arg("--permission-mode").arg("plan");
                }
                "ask" => {}
                _ => {
                    cmd.arg("--dangerously-skip-permissions");
                }
            }

            // Working directory: run in the user's chosen workspace so the
            // agent explores the right project (and add it as an allowed dir).
            if let Some(dir) = cwd.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
                let p = std::path::Path::new(dir);
                if p.is_dir() {
                    cmd.current_dir(p);
                    cmd.arg("--add-dir").arg(dir);
                }
            }
        }

        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                format!("启动 CLI \"{binary}\" 失败: {e}（请确认它已安装并在 PATH 中）")
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
        let out_handle = std::thread::spawn(move || -> String {
            let mut result = String::new();
            let mut acc = String::new();
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
                                                acc.push_str(tx);
                                                emit_progress(&app2, &run2, tx);
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

        let timeout_secs = ai_cli_timeout_secs();
        let idle_timeout_secs = ai_cli_idle_timeout_secs();
        let idle_timeout = (idle_timeout_secs > 0)
            .then(|| std::time::Duration::from_secs(idle_timeout_secs));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);
        let mut last_sidecar_len = 0_u64;
        let mut last_sidecar_modified: Option<std::time::SystemTime> = None;
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
            history::history_root,
            history::history_read_json,
            history::history_write_json,
            history::history_remove,
            history::history_list_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
