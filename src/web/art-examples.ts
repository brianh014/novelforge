import cinematic from "./art-examples/01.webp";
import digital from "./art-examples/02.webp";
import comic from "./art-examples/03.webp";
import cybertech from "./art-examples/04.webp";
import oil from "./art-examples/05.webp";
import watercolor from "./art-examples/06.webp";
import impressionism from "./art-examples/07.webp";
import manuscript from "./art-examples/08.webp";
import ukiyoe from "./art-examples/09.webp";
import nouveau from "./art-examples/10.webp";
import pulp from "./art-examples/11.webp";
import blueprint from "./art-examples/12.webp";
import surrealism from "./art-examples/13.webp";
import cubism from "./art-examples/14.webp";
import deco from "./art-examples/15.webp";
import anime from "./art-examples/16.webp";

/** The same subject in every named Art Style, drawn once by `scripts/draw-style-examples.ts`, so showing them costs the player nothing. */
export const ART_EXAMPLES: Record<string, string> = {
  "Cinematic Photorealism": cinematic,
  "Modern Digital Painting & Concept Art": digital,
  "Graphic Novel & Comic Illustration": comic,
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
  "Modern Anime & Manga Illustration": anime,
};
