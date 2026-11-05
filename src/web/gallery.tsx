import { useEffect, useRef, useState } from "react";
import { type Gallery as GalleryContent, getGallery } from "./api";
import { BookTabs, Sheet } from "./menu";
import { IMAGE_CHECK_MS } from "./play";
import { RedrawableImage } from "./zoom";

export function Gallery({ id }: { id: string }) {
  const [gallery, setGallery] = useState<GalleryContent>();
  const [redraws, setRedraws] = useState(0);
  const [loadError, setLoadError] = useState("");
  const loaded = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let leaving = false;
    const load = () =>
      getGallery(id).then((gallery) => {
        setGallery(gallery);
        loaded.current = true;
        if (gallery.pending && !leaving) timer = setTimeout(load, IMAGE_CHECK_MS);
      }, (failure: Error) => {
        // A failed look for a finished Redraw mustn't take away a Gallery already on the page.
        if (!loaded.current) setLoadError(failure.message);
      });
    load();
    return () => {
      leaving = true;
      clearTimeout(timer);
    };
  }, [id, redraws]);

  return (
    <Sheet
      rail={
        <>
          <h1 className="big">Gallery</h1>
          <a className="quiet" href="#/">Main Menu</a>
        </>
      }
      tabs={<BookTabs id={id} current="Gallery" />}
    >
      {loadError && <p role="alert" className="error">{loadError}</p>}
      {gallery && gallery.images.length === 0 && <p className="muted">No pictures yet.</p>}
      {gallery && gallery.images.length > 0 && (
        <ul className="gallery">
          {gallery.images.map((image) => (
            <li key={`${image.kind}${image.ref}`}>
              <RedrawableImage
                id={id}
                image={image}
                alt={image.label || "Scene Image"}
                canRedraw={gallery.canRedraw}
                onRedrawn={() => setRedraws((count) => count + 1)}
              />
              <span>{image.label}</span>
              {image.redrawing && <span className="waiting">Redrawing…</span>}
              {image.failure && <span className="error">Redraw failed</span>}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
