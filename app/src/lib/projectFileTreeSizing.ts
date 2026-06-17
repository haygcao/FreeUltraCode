const PROJECT_FILE_TREE_DEFAULT_WIDTH = 280;
export const PROJECT_FILE_TREE_MIN_WIDTH = 220;
export const PROJECT_FILE_TREE_MAX_WIDTH = 960;
const PROJECT_FILE_TREE_RESERVED_LAYOUT_WIDTH = 760;

function currentViewportWidth(): number | null {
  if (typeof window === 'undefined') return null;
  return window.innerWidth;
}

export function projectFileTreeMaxWidth(
  viewportWidth: number | null = currentViewportWidth(),
): number {
  if (viewportWidth === null || !Number.isFinite(viewportWidth)) {
    return PROJECT_FILE_TREE_MAX_WIDTH;
  }
  return Math.max(
    PROJECT_FILE_TREE_MIN_WIDTH,
    Math.min(
      PROJECT_FILE_TREE_MAX_WIDTH,
      viewportWidth - PROJECT_FILE_TREE_RESERVED_LAYOUT_WIDTH,
    ),
  );
}

export function projectFileTreeDefaultWidth(
  viewportWidth: number | null = currentViewportWidth(),
): number {
  return Math.min(
    PROJECT_FILE_TREE_DEFAULT_WIDTH,
    projectFileTreeMaxWidth(viewportWidth),
  );
}
