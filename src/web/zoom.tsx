import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { galleryUrl, type GalleryImage, type Portrait, portraitUrl, updateImage, redrawImage, uploadGalleryImage } from "./api";
import { DeleteIcon, EditIcon, Painting, RegenerateIcon, RewriteIcon, UploadIcon } from "./icons";

/** Someone's picture and name, with who they are when that's known. */
export function Person({ id, name, portrait, who }: { id: string; name: string; portrait?: Portrait; who?: string }) {
  return (
    <>
      {portrait ? <Zoomable className="portrait" lazy src={portraitUrl(id, portrait)} alt={name} /> : <span className="portrait" aria-hidden="true" />}
      <span>
        {name}
        {who && <span className="about">{who}</span>}
      </span>
    </>
  );
}

/** The Image Prompt of one image, to Redraw from as it stands or changed. A failed Redraw keeps what was typed. */
export function PromptBox({
  prompt,
  redrawing,
  failure,
  canRedraw,
  onRedraw,
  note,
}: {
  prompt: string | null;
  redrawing: boolean;
  failure: string;
  canRedraw: boolean;
  onRedraw: (prompt: string) => void;
  note?: string;
}) {
  const [text, setText] = useState(prompt ?? "");
  useEffect(() => setText(prompt ?? ""), [prompt]);
  return (
    <form
      className="prompt-box"
      onSubmit={(event) => {
        event.preventDefault();
        onRedraw(text);
      }}
    >
      <label>
        Image Prompt
        <textarea rows={5} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      {prompt === null && <p className="muted">This image's prompt wasn't kept.</p>}
      {failure && (
        <p role="alert" className="error">
          {failure}
        </p>
      )}
      {redrawing && (
        <p role="status" className="waiting drawing">
          {Painting}This image is being redrawn…
        </p>
      )}
      {!canRedraw && <p className="muted">Images are turned off or not set up in Settings.</p>}
      {note && <p className="muted">{note}</p>}
      <p className="muted">Each Redraw draws one new image, which may cost money.</p>
      <div className="row">
        <button type="submit" className="action" disabled={redrawing || !canRedraw || !text.trim()}>
          Redraw
        </button>
      </div>
    </form>
  );
}

/**
 * An icon that opens a dialog for a few words of the player's own, such as "smiling", worked into the picture's next prompt,
 * which is then drawn. `initial` is the nudge used last, where one is kept.
 */
export function NudgeButton({
  label,
  disabled,
  initial = "",
  onNudge,
}: {
  label: string;
  disabled?: boolean;
  initial?: string;
  onNudge: (nudge: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [nudge, setNudge] = useState(initial);
  const title = useId();
  return (
    <>
      <button
        type="button"
        className="icon"
        title="Nudge: draw it again with a few words of your own"
        aria-label={label}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => {
          setNudge(initial);
          dialog.current!.showModal();
        }}
      >
        {RewriteIcon}
      </button>
      <dialog ref={dialog} aria-labelledby={title}>
        <form
          method="dialog"
          className="fields"
          onSubmit={() => {
            // The dialog shuts itself, as the form's method says.
            onNudge(nudge.trim());
          }}
        >
          <h2 id={title}>Nudge</h2>
          <label>
            What should be different?
            <input maxLength={200} placeholder="such as smiling" value={nudge} onChange={(event) => setNudge(event.target.value)} />
          </label>
          <p className="muted">A new prompt is written with your words in it, and the picture is drawn again. Each picture drawn may cost money.</p>
          {/* Cancel first, as a modal focuses its first control, and that mustn't be the one that draws. */}
          <div className="row">
            <button type="button" className="quiet" onClick={() => dialog.current!.close()}>
              Cancel
            </button>
            <button type="submit" className="action" disabled={!nudge.trim()}>
              Draw it
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** An icon button that picks a picture file of the player's own, in place of a drawn one. */
export function UploadButton({ label, disabled, onFile }: { label: string; disabled?: boolean; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="icon" title="Upload your own picture" aria-label={label} disabled={disabled} onClick={() => input.current!.click()}>
        {UploadIcon}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared, so choosing the same file again still counts as a change.
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </>
  );
}

/** Keeps a viewed picture clear of its prompt until asked. It stays open to show a Redraw under way or failed, and shuts with the dialog. */
/** `actions` are more icon buttons for the row beside the Redraw pencil. */
/** `status` shows while the panel is shut, so a drawing started from `actions` reports without opening the Image Prompt. */
export function RedrawPanel({ busy, children, actions, status }: { busy: boolean; children: ReactNode; actions?: ReactNode; status?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = panel.current!.closest("dialog")!;
    const shut = () => setOpen(false);
    dialog.addEventListener("close", shut);
    return () => dialog.removeEventListener("close", shut);
  }, []);
  const shown = open || busy;
  return (
    <>
      <div className="row">
        <button type="button" className="icon" title="Redraw" aria-label="Redraw" aria-expanded={shown} disabled={busy} onClick={() => setOpen(!open)}>
          {EditIcon}
        </button>
        {actions}
      </div>
      {!shown && status}
      {/* Hidden rather than removed, so a dialog closed and opened again keeps what was typed. */}
      <div ref={panel} className="redraw-panel" hidden={!shown}>
        {children}
      </div>
    </>
  );
}

/**
 * An image of a Save, which opens larger with its prompt behind a button. `onRedrawn` is for reading the Gallery again, as
 * drawing goes on in the background. `canUpdate` offers a new prompt from the story and an upload of the player's own, and `onDelete` a Delete, inside the view.
 */
export function RedrawableImage({
  id,
  image,
  alt,
  canRedraw,
  onRedrawn,
  canUpdate = false,
  onDelete,
  original,
}: {
  id: string;
  image: GalleryImage;
  original?: GalleryImage;
  alt: string;
  canRedraw: boolean;
  onRedrawn: () => void;
  canUpdate?: boolean;
  onDelete?: () => void;
}) {
  const [refused, setRefused] = useState("");
  const [seeOriginal, setSeeOriginal] = useState(false);
  const started = (work: Promise<object>) => {
    setRefused("");
    work.then(onRedrawn, (failure: Error) => setRefused(failure.message));
  };
  // The latest shows first, and the buttons below act on whichever is shown.
  const latest = image;
  const shown = seeOriginal && original ? original : latest;
  const shownAlt = shown === latest ? alt : `${alt}, original`;
  return (
    <Zoomable lazy src={galleryUrl(id, latest)} largeSrc={galleryUrl(id, shown)} alt={alt} largeAlt={shownAlt} onClose={() => setSeeOriginal(false)}>
      {original && (
        <div className="row">
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setRefused("");
              setSeeOriginal(!seeOriginal);
            }}
          >
            {shown === latest ? "See the original" : "See the latest"}
          </button>
        </div>
      )}
      <RedrawPanel
        busy={false}
        status={
          <>
            {(shown.failure || refused) && (
              <p role="alert" className="error">
                {shown.failure || refused}
              </p>
            )}
            {shown.redrawing && (
              <p role="status" className="waiting drawing">
                {Painting}This image is being drawn…
              </p>
            )}
          </>
        }
        actions={
          <>
            {canUpdate && (
              <button
                type="button"
                className="icon"
                title={
                  shown.kind !== "cover"
                    ? "Update: draw them as they are now in the story, keeping their face"
                    : "Update: write a new prompt from the story as it is now, and draw it"
                }
                aria-label="Update"
                disabled={shown.redrawing || !canRedraw}
                onClick={() => started(updateImage(id, shown))}
              >
                {RegenerateIcon}
              </button>
            )}
            {canUpdate && (
              <NudgeButton label={`Nudge: ${shownAlt}`} disabled={shown.redrawing || !canRedraw} onNudge={(nudge) => started(updateImage(id, shown, nudge))} />
            )}
            {canUpdate && (
              <UploadButton
                label={`Upload your own picture: ${shownAlt}`}
                disabled={shown.redrawing}
                onFile={(file) => started(uploadGalleryImage(id, shown, file))}
              />
            )}
            {onDelete && (
              <button type="button" className="icon" title="Delete" aria-label="Delete" aria-haspopup="dialog" disabled={shown.redrawing} onClick={onDelete}>
                {DeleteIcon}
              </button>
            )}
          </>
        }
      >
        <PromptBox
          prompt={shown.prompt}
          redrawing={shown.redrawing}
          failure={shown.failure || refused}
          canRedraw={canRedraw}
          onRedraw={(prompt) => started(redrawImage(id, shown, prompt))}
          note={
            shown.kind === "scene" || shown.kind === "requested"
              ? "A Redraw uses each person's latest portrait, which may have changed since this scene was drawn."
              : undefined
          }
        />
      </RedrawPanel>
    </Zoomable>
  );
}

/** A picture that opens larger in a dialog, which the browser closes on Escape. `onLoad` and `onError` are for pictures still being drawn. */
export function Zoomable(props: {
  src: string;
  alt: string;
  className?: string;
  lazy?: boolean;
  onLoad?: () => void;
  onError?: () => void;
  children?: ReactNode;
  /** What the opened view shows, when not `src`. */
  largeSrc?: string;
  /** Its name, when not `alt`. */
  largeAlt?: string;
  onClose?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className="zoom" aria-label={`View larger: ${props.alt}`} onClick={() => dialog.current!.showModal()}>
        <img
          className={props.className}
          loading={props.lazy ? "lazy" : undefined}
          src={props.src}
          alt={props.alt}
          onLoad={props.onLoad}
          onError={props.onError}
        />
      </button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: a click on the backdrop closes it, as Escape already does by keyboard. */}
      <dialog
        ref={dialog}
        className="viewer"
        aria-label={props.alt}
        onClose={props.onClose}
        onClick={(event) => event.target === dialog.current && dialog.current.close()}
      >
        <img src={props.largeSrc ?? props.src} alt={props.largeAlt ?? props.alt} loading="lazy" />
        {props.children}
        <div className="row">
          <button type="button" className={props.children ? "quiet" : "action"} onClick={() => dialog.current!.close()}>
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
