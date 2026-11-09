import { drawingFamily } from "../graph-builder";

/** Every named Art Style, with the description that is sent to the image model. */
export const ART_STYLES: Record<string, string> = {
  "Cinematic Photorealism":
    "Ultra-detailed photorealistic style capturing hyper-accurate physics, micro-surface textures, natural volumetric light dispersion, realistic lens depth of field, and true-to-life subsurface scattering, indistinguishable from high-resolution digital cinema footage.",
  "Modern Digital Painting & Concept Art":
    "Clean, high-definition digital realism combining smooth blended gradients, rich volumetric atmosphere, dynamic lighting, and expressive digital brushwork—balancing sharp edge control with polished character and environment art rendering.",
  "Stylized Fantasy Illustration":
    "Semi-realistic stylized fantasy illustration, like a painted video game character portrait: smooth airbrushed shading, crisp outlines, idealized painted features and a clean illustrated finish.",
  "Painted 3D Fantasy":
    "Stylized painted fantasy character art in the style of Arcane and Blizzard cinematics: hand-painted 3D look, slightly exaggerated proportions and features, smooth airbrushed shading, crisp outlines, bold simplified shapes and a clean illustrated finish.",
  "Storybook Fantasy":
    "A stylized fantasy illustration, clearly drawn rather than photographed: clean confident outlines, smooth airbrushed cel-like shading, idealized painted faces with large expressive eyes, simplified painted landscape shapes and a bright storybook finish, like a painted video game character portrait.",
  "Graphic Novel & Comic Illustration":
    "Bold graphic aesthetic defined by clean ink linework, stylized cell-shading, dynamic speed lines, sharp silhouettes, and saturated flat tones with optional Ben-Day halftone dot patterns.",
  "Modern Anime & Manga Illustration":
    "Polished Japanese graphic art style featuring sharp ink contour lines, vibrant cell-shading, expressive eye dynamics, clean hair clumps, and dramatic action-line perspective.",
  // Said as what is there, as an image model draws whatever it's told to leave out.
  "Everyday Phone Photo":
    "An everyday smartphone snapshot: true-to-life colours, plain natural or indoor light, deep focus with the background as sharp as the subject, flat even contrast, a casual eye-level angle, an unposed candid moment and the slight noise and sharpening of a phone camera, like a photo in someone's camera roll.",
  "Cybertech & Retro-Futuristic Neon":
    "High-contrast, rain-slicked sci-fi aesthetic blending 1980s low-life street aesthetics with glowing neon-cyan and magenta palettes, hard-edged cyberware detail, dark atmospheric chiaroscuro, and wireframe perspective grids.",
  "Traditional Impasto Oil Painting":
    "Richly textured painterly realism featuring visible expressive brushstrokes, dynamic palette knife work, deep glazes, physical impasto texture, and dramatic chiaroscuro lighting across vibrant, wet-on-wet blended pigments.",
  "Luminous Fluid Watercolor":
    "Soft semi-translucent aesthetic characterized by delicate watery washes, soft-edge color bleeding, visible paper grain texture, expressive paint splatters, and vibrant pigment pooling along fine hand-drawn ink contours.",
  "Impressionism, Post-Impressionism & Expressionism":
    "Vibrant, light-focused style featuring rapid broken brushstrokes, unblended pure pigments, raw jagged linework, and non-naturalistic, emotionally intense color choices with visible motion.",
  "Medieval Romanesque & Gothic Manuscript":
    "Flat two-dimensional composition with bold ink outlines, stylized expressive figures, luminous gilded leafing, geometric drapery folds, and hierarchical scaling set against saturated primary pigments and intricate architectural border ornamentation.",
  "Japanese Ukiyo-e Woodblock":
    "Traditional Edo-period aesthetic defined by flat graphic compositions, strong black ink outlines, rhythmic wave and cloud motifs, subtle paper grain, and layered block-printed pigment washes.",
  "Art Nouveau Decorative Illustration":
    "Ornate turn-of-the-century aesthetic featuring sweeping organic curves, flowing stylized hair and drapery, flat-toned figures, and intricate floral frame borders inspired by Alphonse Mucha.",
  "Retro Sci-Fi Pulp Illustration":
    "High-contrast 1970s and 80s book-cover art featuring bold gouache and airbrush gradients, vivid speculative color palettes, dramatic heroic staging, painterly space hardware, and atmospheric cosmic dust.",
  "Architectural Blueprint & Technical Drafting":
    "Precision monochrome drafting style featuring crisp white or cyan vector linework on a dark background, grid overlays, detailed cross-sections, schematic callouts, and clean geometric typography.",
  "Surrealism & Dream Logic":
    "Mind-bending realism blending precise, dreamlike detail with impossible juxtaposition, melting forms, hyper-smooth gradients, and unsettling atmospheric lighting inspired by Salvador Dalí and René Magritte.",
  "Cubism & Geometric Abstraction":
    "Deconstructed perspective breaking subjects into sharp faceted geometric planes, overlapping angular shapes, and muted monochromatic tone palettes.",
  "Art Deco & Streamline Moderne":
    "Symmetrical luxury aesthetic featuring sharp geometric line work, metallic gold/bronze accents, sleek aerodynamic curves, high-contrast black-and-gold tones, and sunburst motifs.",
};

type Family = NonNullable<ReturnType<typeof drawingFamily>>;

/**
 * A family's own wording for a named style that it draws wrong from the shared one, kept to wording that was tried on it.
 * Qwen Image 2.1 Turbo draws these styles' shared text close to a photograph.
 */
const FAMILY_ART_STYLES: Partial<Record<Family, Record<string, string>>> = {
  qwen21: {
    "Modern Digital Painting & Concept Art":
      "High-end digital illustration in the style of ArtStation fantasy concept art: semi-realistic painted forms, smooth gradients, crisp edge control, slightly stylized features, glowing volumetric light and a clean polished digital finish.",
    "Stylized Fantasy Illustration":
      "Modern digital painting and concept art, stylized: semi-realistic stylized fantasy illustration, like a painted video game character portrait, smooth airbrushed shading, crisp outlines, idealized painted features and a clean illustrated finish.",
    "Traditional Impasto Oil Painting":
      "A thick impasto oil painting on canvas: heavy ridged brushstrokes and palette knife slabs of paint visible everywhere, including on the face and clothes, chunky sculpted texture, deep glazes, dramatic chiaroscuro, wet-on-wet blended pigments, clearly a hand-painted artwork.",
    "Impressionism, Post-Impressionism & Expressionism":
      "A Post-Impressionist oil painting in the style of Vincent van Gogh: swirling thick brushstrokes in every surface, unblended pure bright pigments, cobalt blue, chrome yellow and vivid orange, raw dark outlines, an emotionally intense, non-naturalistic painted world.",
    "Retro Sci-Fi Pulp Illustration":
      "Vintage retro-futurist pulp magazine cover art: a hand-painted gouache illustration with airbrushed gradient skies of purple and orange, giant ringed planets on the horizon, alien spires in the distance, bold saturated colours, heroic pose and a slightly worn printed look.",
    "Surrealism & Dream Logic":
      "A dreamlike Surrealist painting inspired by René Magritte and Salvador Dalí: the sky cracked open like a painted wall, a giant floating eye and stone spheres hanging in the air, the road rising into the clouds, smooth precise oil paint and eerie impossible light.",
  },
};

/** The Art Style as `family` should read it. A Save stores a named style as "Name: description", and the player's own words never change. */
export function artStyleFor(artStyle: string, family: Family | null) {
  const own = family && FAMILY_ART_STYLES[family];
  if (!own) return artStyle;
  const name = Object.keys(own).find((style) => artStyle.trim() === `${style}: ${ART_STYLES[style]}`);
  return name ? `${name}: ${own[name]}` : artStyle;
}

/** A Save whose Art Style reads as the family drawing now wants it, for writing an Image Prompt. */
export const withArtStyleFor = <T extends { artStyle?: string }>(save: T, settings: Parameters<typeof drawingFamily>[0]) => ({
  ...save,
  artStyle: artStyleFor(save.artStyle ?? "", drawingFamily(settings)),
});
