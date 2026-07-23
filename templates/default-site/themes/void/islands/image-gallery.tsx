import { useEffect } from "preact/hooks";
import lightGallery from "lightgallery";
import lgZoom from "lightgallery/plugins/zoom";

const PREPARED = "data-lg-prepared";
const ANCHOR = "data-lg";

function imageSrc(img: HTMLImageElement): string {
  return img.currentSrc || img.getAttribute("src") || "";
}

function prepareContentImages(root: ParentNode): number {
  const images = root.querySelectorAll<HTMLImageElement>(
    `.content img:not([${PREPARED}])`,
  );
  let count = 0;

  images.forEach((img) => {
    const src = imageSrc(img);
    if (!src) {
      img.setAttribute(PREPARED, "");
      return;
    }

    const parent = img.parentElement;
    if (parent?.tagName === "A") {
      parent.setAttribute(ANCHOR, "");
      if (!parent.getAttribute("href")) {
        parent.setAttribute("href", src);
      }
      parent.setAttribute("data-src", src);
      if (img.alt) {
        parent.setAttribute("data-sub-html", img.alt);
      }
      img.setAttribute(PREPARED, "");
      count += 1;
      return;
    }

    const anchor = document.createElement("a");
    anchor.setAttribute(ANCHOR, "");
    anchor.setAttribute("href", src);
    anchor.setAttribute("data-src", src);
    if (img.alt) {
      anchor.setAttribute("data-sub-html", img.alt);
    }
    img.replaceWith(anchor);
    anchor.appendChild(img);
    img.setAttribute(PREPARED, "");
    count += 1;
  });

  return count;
}

export default function ImageGallery() {
  useEffect(() => {
    prepareContentImages(document);

    const containers = document.querySelectorAll<HTMLElement>(".content");
    const instances: Array<{ destroy: () => void }> = [];

    containers.forEach((container) => {
      if (!container.querySelector(`a[${ANCHOR}]`)) return;

      const instance = lightGallery(container, {
        selector: `a[${ANCHOR}]`,
        plugins: [lgZoom],
        speed: 400,
        download: false,
        counter: true,
        mobileSettings: {
          controls: true,
          showCloseIcon: true,
        },
      });
      instances.push(instance);
    });

    return () => {
      for (const instance of instances) {
        instance.destroy();
      }
    };
  }, []);

  return null;
}
