import { describe, expect, it } from 'vitest';
import {
  PROJECT_FILE_TREE_MAX_WIDTH,
  PROJECT_FILE_TREE_MIN_WIDTH,
  projectFileTreeDefaultWidth,
  projectFileTreeMaxWidth,
} from './projectFileTreeSizing';

describe('projectFileTreeSizing', () => {
  it('lets the right project panel grow wider on large windows', () => {
    expect(projectFileTreeMaxWidth(1506)).toBe(746);
    expect(projectFileTreeMaxWidth(1920)).toBe(PROJECT_FILE_TREE_MAX_WIDTH);
  });

  it('keeps a usable center area on narrow desktop windows', () => {
    expect(projectFileTreeMaxWidth(1024)).toBe(264);
    expect(projectFileTreeMaxWidth(900)).toBe(PROJECT_FILE_TREE_MIN_WIDTH);
    expect(projectFileTreeDefaultWidth(1024)).toBe(264);
  });
});
