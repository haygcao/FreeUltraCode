import { describe, expect, it } from 'vitest';
import { executableExtensionOf } from './tauri';

describe('executableExtensionOf', () => {
  it('detects Windows drive-letter executable paths', () => {
    expect(executableExtensionOf('C:\\Temp\\evil.exe')).toBe('exe');
    expect(executableExtensionOf('D:\\Tools\\shortcut.lnk')).toBe('lnk');
  });

  it('strips query/hash and editor line hints without cutting the drive prefix', () => {
    expect(executableExtensionOf('C:\\Temp\\evil.exe?download=1')).toBe('exe');
    expect(executableExtensionOf('C:\\Temp\\shortcut.lnk#L12')).toBe('lnk');
    expect(executableExtensionOf('C:\\Temp\\script.ps1:12:3')).toBe('ps1');
  });

  it('ignores non-executable paths', () => {
    expect(executableExtensionOf('C:\\Temp\\notes.txt')).toBeNull();
  });
});
