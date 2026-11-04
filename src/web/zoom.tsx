import { useRef } from "react";
import { type Portrait, portraitUrl } from "./api";

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

/** A picture that opens larger in a dialog, which the browser closes on Escape. `onLoad` and `onError` are for pictures still being drawn. */
export function Zoomable(props: {
  src: string;
  alt: string;
  className?: string;
  lazy?: boolean;
  onLoad?: () => void;
  onError?: () => void;
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
      <dialog ref={dialog} className="viewer" aria-label={props.alt} onClick={(event) => event.target === dialog.current && dialog.current.close()}>
        <img src={props.src} alt={props.alt} loading="lazy" />
        <div className="row">
          <button type="button" className="action" onClick={() => dialog.current!.close()}>
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
