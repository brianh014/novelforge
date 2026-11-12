import { useEffect, useState } from "react";
import { getHeldImage, type HeldImage, type HeldPicture, heldImageUrl, redrawHeldImage } from "./api";
import { Painting, RegenerateIcon } from "./icons";
import { NudgeButton, PromptBox, RedrawPanel, UploadButton, Zoomable } from "./zoom";

/** What a picture is called, and how it's described to a screen reader. */
export type Naming = { name: string; alt: string };

/**
 * A Cover or portrait the server holds, which may still be painting. A failed one offers its prompt to try again.
 * `onLost` is for one the server no longer holds or never drew, so that the form can offer it again.
 */
function HeldArt(props: { id: string; picture: HeldPicture; naming: Naming; version: number; onRedrawn: () => void; onLost: () => void }) {
  const { id, picture, version, onRedrawn, onLost } = props;
  const { name, alt } = props.naming;
  const [image, setImage] = useState<HeldImage>();
  const [redrawing, setRedrawing] = useState(false);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    let leaving = false;
    setImage(undefined);
    getHeldImage(id, picture).then(
      (details) => {
        if (leaving) return;
        setImage(details);
        setFailure(details.failure);
        if (!details.hasImage && !details.failure) onLost();
      },
      () => !leaving && onLost(),
    );
    return () => {
      leaving = true;
    };
  }, [id, picture, version]);

  if (!image)
    return (
      <p className="waiting drawing">
        {Painting}The {name} is being painted…
      </p>
    );

  const redraw = (prompt: string) => {
    setRedrawing(true);
    setFailure("");
    redrawHeldImage(id, picture, prompt)
      .then(onRedrawn, (error: Error) => setFailure(error.message))
      .finally(() => setRedrawing(false));
  };
  const box = <PromptBox prompt={image.prompt} redrawing={redrawing} failure={failure} canRedraw={image.canRedraw} onRedraw={redraw} />;

  if (!image.hasImage) {
    return failure || redrawing ? (
      <>
        <p className="muted">The {name} couldn't be painted. You can try again, upload your own, or carry on without one.</p>
        {box}
      </>
    ) : null;
  }
  return (
    <>
      <figure className={picture === "cover" ? "plate cover" : "plate"}>
        <Zoomable src={heldImageUrl(id, picture, version)} alt={alt}>
          <RedrawPanel busy={redrawing || !!failure}>{box}</RedrawPanel>
        </Zoomable>
      </figure>
      {redrawing && (
        <p className="waiting drawing">
          {Painting}Redrawing the {name}…
        </p>
      )}
      {failure && <p className="error">Redraw failed. Open the {name} to see why.</p>}
    </>
  );
}

/**
 * One picture with its Draw or Redo and an upload. `missing` says what must be filled before it can be drawn. Each stays in
 * place after the world is written, as changing a picture changes nothing in the world. `onCover` is a character's choice to
 * be on the Cover, which a Cover has none of. `version` is undefined until the picture is asked for or uploaded.
 */
export function PictureSection(props: {
  picture: HeldPicture;
  legend: string;
  naming: Naming;
  missing: string;
  onCover?: { on: boolean; set: (on: boolean) => void };
  id: string | undefined;
  version: number | undefined;
  nudge: string | undefined;
  imagesReady: boolean | undefined;
  asking: boolean;
  onDraw: (nudge?: string) => void;
  onUpload: (file: File) => void;
  onRedrawn: () => void;
  onLost: () => void;
}) {
  const { picture, legend, naming, missing, onCover, id, version, imagesReady, asking, onDraw } = props;
  const held = id && version !== undefined;
  return (
    <div>
      <fieldset>
        <legend>{legend}</legend>
        {held && <HeldArt id={id} picture={picture} naming={naming} version={version} onRedrawn={props.onRedrawn} onLost={props.onLost} />}
        {imagesReady === false ? (
          <p className="muted">Images are turned off or not set up in Settings, but you can upload your own.</p>
        ) : (
          (missing || !held) && <p className="muted">{missing || "Draw it now to see it, or leave it and it's drawn when the world is written."}</p>
        )}
        {/* The Cover choice sits with the tools, not above the picture, so every picture in a row starts level. */}
        <div className="row">
          {onCover && (
            <label className="toggle">
              <input type="checkbox" checked={onCover.on} onChange={(e) => onCover.set(e.target.checked)} />
              On the Cover
            </label>
          )}
          {imagesReady !== false &&
            // Redo is an icon beside Nudge and Upload, as the Gallery's Update is. A first Draw stays in words, as nothing is there yet.
            (held ? (
              <button
                type="button"
                className="icon"
                title="Redo: write a new prompt from your choices as they are now, and draw it"
                aria-label={`Redo the ${naming.name}: ${legend}`}
                disabled={!!missing || asking}
                onClick={() => onDraw()}
              >
                {RegenerateIcon}
              </button>
            ) : (
              <button type="button" className="quiet" disabled={!!missing || asking} onClick={() => onDraw()}>
                Draw the {naming.name}
              </button>
            ))}
          {imagesReady !== false && (
            <NudgeButton label={`Nudge the ${naming.name}: ${legend}`} disabled={!!missing || asking} initial={props.nudge} onNudge={onDraw} />
          )}
          <UploadButton label={`Upload your own ${naming.name}: ${legend}`} disabled={asking} onFile={props.onUpload} />
        </div>
      </fieldset>
    </div>
  );
}
