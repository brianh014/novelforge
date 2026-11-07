const icon = (path: string) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={path} />
  </svg>
);

export const ChapterIcon = icon("M6 3h12v18l-6-4-6 4z");
export const DecideIcon = icon("M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z");
export const DrawIcon = icon("M3 5h18v14H3zM3 16l5-5 5 5 3-3 5 5M15.5 9.5h.01");
export const DownIcon = icon("M12 4v16M5 13l7 7 7-7");
export const DuplicateIcon = icon("M8 3h9l3 3v12H8zM4 7v14h11");
export const EditIcon = icon("M4 20l1-5L16 4l4 4L9 19zM14 6l4 4");
export const RewriteIcon = icon("M20 3c-7 1-12 6-14 14M20 3c0 6-3 10-9 11M4 21l2-4");
export const RegenerateIcon = icon("M20 12a8 8 0 1 1-2.4-5.7M20 3v5h-5");
export const RevertIcon = icon("M4 12a8 8 0 1 0 2.4-5.7M4 3v5h5");
