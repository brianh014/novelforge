import cinematic from "./art-examples/01.webp";
import digital from "./art-examples/02.webp";
import stylized from "./art-examples/03.webp";
import painted3d from "./art-examples/04.webp";
import storybook from "./art-examples/05.webp";
import comic from "./art-examples/06.webp";
import anime from "./art-examples/07.webp";
import cybertech from "./art-examples/08.webp";
import oil from "./art-examples/09.webp";
import watercolor from "./art-examples/10.webp";
import impressionism from "./art-examples/11.webp";
import manuscript from "./art-examples/12.webp";
import ukiyoe from "./art-examples/13.webp";
import nouveau from "./art-examples/14.webp";
import pulp from "./art-examples/15.webp";
import blueprint from "./art-examples/16.webp";
import surrealism from "./art-examples/17.webp";
import cubism from "./art-examples/18.webp";
import deco from "./art-examples/19.webp";
import qwenCinematic from "./art-examples/qwen/01.webp";
import qwenDigital from "./art-examples/qwen/02.webp";
import qwenStylized from "./art-examples/qwen/03.webp";
import qwenPainted3d from "./art-examples/qwen/04.webp";
import qwenStorybook from "./art-examples/qwen/05.webp";
import qwenComic from "./art-examples/qwen/06.webp";
import qwenAnime from "./art-examples/qwen/07.webp";
import qwenCybertech from "./art-examples/qwen/08.webp";
import qwenOil from "./art-examples/qwen/09.webp";
import qwenWatercolor from "./art-examples/qwen/10.webp";
import qwenImpressionism from "./art-examples/qwen/11.webp";
import qwenManuscript from "./art-examples/qwen/12.webp";
import qwenUkiyoe from "./art-examples/qwen/13.webp";
import qwenNouveau from "./art-examples/qwen/14.webp";
import qwenPulp from "./art-examples/qwen/15.webp";
import qwenBlueprint from "./art-examples/qwen/16.webp";
import qwenSurrealism from "./art-examples/qwen/17.webp";
import qwenCubism from "./art-examples/qwen/18.webp";
import qwenDeco from "./art-examples/qwen/19.webp";

/** The same subject in every named Art Style, drawn once by `scripts/draw-style-examples.ts`, so showing them costs the player nothing. */
export const ART_EXAMPLES: Record<string, string> = {
  "Cinematic Photorealism": cinematic,
  "Modern Digital Painting & Concept Art": digital,
  "Stylized Fantasy Illustration": stylized,
  "Painted 3D Fantasy": painted3d,
  "Storybook Fantasy": storybook,
  "Graphic Novel & Comic Illustration": comic,
  "Modern Anime & Manga Illustration": anime,
  "Cybertech & Retro-Futuristic Neon": cybertech,
  "Traditional Impasto Oil Painting": oil,
  "Luminous Fluid Watercolor": watercolor,
  "Impressionism, Post-Impressionism & Expressionism": impressionism,
  "Medieval Romanesque & Gothic Manuscript": manuscript,
  "Japanese Ukiyo-e Woodblock": ukiyoe,
  "Art Nouveau Decorative Illustration": nouveau,
  "Retro Sci-Fi Pulp Illustration": pulp,
  "Architectural Blueprint & Technical Drafting": blueprint,
  "Surrealism & Dream Logic": surrealism,
  "Cubism & Geometric Abstraction": cubism,
  "Art Deco & Streamline Moderne": deco,
};

/** The same examples drawn on Qwen Image 2.1, in the wording it gets, shown when Qwen is the family in Settings. */
export const QWEN_ART_EXAMPLES: Record<string, string> = {
  "Cinematic Photorealism": qwenCinematic,
  "Modern Digital Painting & Concept Art": qwenDigital,
  "Stylized Fantasy Illustration": qwenStylized,
  "Painted 3D Fantasy": qwenPainted3d,
  "Storybook Fantasy": qwenStorybook,
  "Graphic Novel & Comic Illustration": qwenComic,
  "Modern Anime & Manga Illustration": qwenAnime,
  "Cybertech & Retro-Futuristic Neon": qwenCybertech,
  "Traditional Impasto Oil Painting": qwenOil,
  "Luminous Fluid Watercolor": qwenWatercolor,
  "Impressionism, Post-Impressionism & Expressionism": qwenImpressionism,
  "Medieval Romanesque & Gothic Manuscript": qwenManuscript,
  "Japanese Ukiyo-e Woodblock": qwenUkiyoe,
  "Art Nouveau Decorative Illustration": qwenNouveau,
  "Retro Sci-Fi Pulp Illustration": qwenPulp,
  "Architectural Blueprint & Technical Drafting": qwenBlueprint,
  "Surrealism & Dream Logic": qwenSurrealism,
  "Cubism & Geometric Abstraction": qwenCubism,
  "Art Deco & Streamline Moderne": qwenDeco,
};
