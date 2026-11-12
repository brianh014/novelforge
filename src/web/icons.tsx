const icon = (path: string) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={path} />
  </svg>
);

export const ChapterIcon = icon("M6 3h12v18l-6-4-6 4z");
export const ContinueIcon = icon("M4 12h16M13 5l7 7-7 7");
export const DeleteIcon = icon("M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6");
export const DecideIcon = icon("M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z");
export const DrawIcon = icon("M3 5h18v14H3zM3 16l5-5 5 5 3-3 5 5M15.5 9.5h.01");
export const AskIcon = icon("M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01");
export const DownIcon = icon("M12 4v16M5 13l7 7 7-7");
export const DuplicateIcon = icon("M8 3h9l3 3v12H8zM4 7v14h11");
export const ExportIcon = icon("M12 4v11M7 10l5 5 5-5M4 15v5h16v-5");
/** A name tag. */
export const RenameIcon = icon("M3 12V4h8l10 10-8 8zM7.5 7.5h.01");
export const EditIcon = icon("M4 20l1-5L16 4l4 4L9 19zM14 6l4 4");
/** A quill, for rewriting a passage or nudging a picture. */
export const RewriteIcon = icon("M20 3c-7 1-12 6-14 14M20 3c0 6-3 10-9 11M4 21l2-4");
export const RegenerateIcon = icon("M20 12a8 8 0 1 1-2.4-5.7M20 3v5h-5");
export const UploadIcon = icon("M12 15V4M7 9l5-5 5 5M4 15v5h16v-5");
export const StopIcon = icon("M7 7h10v10H7z");
export const SendIcon = icon("M12 20V4M5 11l7-7 7 7");
export const RevertIcon = icon("M4 12a8 8 0 1 0 2.4-5.7M4 3v5h5");

const SCRIBBLE = "M7 18q1.5-2 3 0t3 0";
/** A quill scribbling on the spot, for beside the words of a Narrator at work. Its moves are in styles.css. */
export const Quilling = (
  <svg className="painting quilling" viewBox="0 0 32 24" aria-hidden="true">
    <path className="ink" d={SCRIBBLE} />
    <g className="pen" style={{ offsetPath: `path("${SCRIBBLE}")` }}>
      <path d="M20 3c-7 1-12 6-14 14M20 3c0 6-3 10-9 11M4 21l2-4" transform="scale(.8) translate(-4 -21)" />
    </g>
  </svg>
);

const HILLS = "M4 19l7-8 5 5 4-4 8 7";
/** A brush painting hills in a frame, then a sun, for beside the words of a picture being drawn. Its moves are in styles.css. */
export const Painting = (
  <svg className="painting" viewBox="0 0 32 24" aria-hidden="true">
    <rect className="frame" x="2" y="2" width="28" height="20" rx="1" />
    <path className="hills" d={HILLS} pathLength={1} />
    <circle className="sun" cx="22" cy="7.5" r="2" />
    <g className="brush" style={{ offsetPath: `path("${HILLS}")` }}>
      <path d="M0 0c.5-1.5 1.5-2.5 2.5-2.5l1 1c0 1-1 2-2.5 2.5zM3-2l6-6" />
    </g>
  </svg>
);
