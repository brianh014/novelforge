import type { ReactNode } from "react";
import {
  AskIcon,
  ChapterIcon,
  ChoicesIcon,
  ContinueIcon,
  DecideIcon,
  DeleteIcon,
  DrawIcon,
  DuplicateIcon,
  EditIcon,
  ExportIcon,
  RegenerateIcon,
  RenameIcon,
  RevertIcon,
  RewriteIcon,
  SendIcon,
  StopIcon,
  UploadIcon,
} from "./icons";
import { MenuRibbon, Sheet } from "./menu";

/** The Reader's Guide: what NovelForge is and how to use every part of it, one section at a time, kept in the URL hash. */

/** A tool as it looks on screen: its icon, then its name. */
const tool = (icon: ReactNode, name: string) => (
  <b className="guide-tool">
    {icon}
    {name}
  </b>
);

const link = (slug: string, text: string) => <a href={`#/guide/${slug}`}>{text}</a>;

const SECTIONS: { slug: string; name: string; body: ReactNode }[] = [
  {
    slug: "start",
    name: "Getting started",
    body: (
      <>
        <p>
          NovelForge is a choose-your-own visual novel that is written as you play. You make a world and a character, your <b>PC</b>, then act and speak only as
          them. An AI plays the <b>Narrator</b>: it tells the story, voices everyone else, keeps track of the world and quietly decides whether what you try
          works. An image AI draws the Cover, portraits and scenes as you go.
        </p>
        <p>NovelForge runs on your own computer. It brings no AI of its own: you connect the ones you choose, and your stories stay on your computer.</p>
        <h3>Your first story</h3>
        <ol>
          <li>
            Open <b>Settings → Text</b> and fill in the AI that writes your story: where it is, which one, and its key. {link("models", "Choosing your AI")}{" "}
            says which to pick. Press <b>Test text</b> to check it answers.
          </li>
          <li>
            Optionally, open <b>Settings → Images</b> and set up an image AI, then press <b>Test image</b>. Without one, the story is text only.
          </li>
          <li>
            Back on the Menu, choose <b>New Story</b>. Write as much or as little as you like, or press {tool(DecideIcon, "Pick for me")} and let the Narrator
            fill it in. See {link("new", "Making a story")}.
          </li>
          <li>Read the Opening, then type what your PC does or says and send it. See {link("play", "Playing")}.</li>
        </ol>
        <p>Everything saves as you go. There is no save button: come back any time with Load Story.</p>
      </>
    ),
  },
  {
    slug: "models",
    name: "Choosing your AI",
    body: (
      <>
        <h3>The story: an online AI is best</h3>
        <p>
          The Narrator needs a capable AI. Each Turn sends it the newest Messages in full, plus the world, the Journal and the Old Memories, so a long story's
          prompt grows past 30,000 tokens. A large online AI takes all of that, keeps the story straight and costs pennies a Turn.
        </p>
        <ul>
          <li>
            <b>OpenRouter</b>: choose it as the Text provider, paste your OpenRouter key and pick a model. You can also choose which of its providers serves the
            model, and how it routes. Staying on one provider keeps its prompt cache, which makes each Turn cheaper.
          </li>
          <li>
            <b>Any other OpenAI-compatible service</b>, such as DeepInfra: choose <b>Local / OpenAI server</b>, give its address (for DeepInfra,{" "}
            <code>https://api.deepinfra.com/v1/openai</code>), save, then pick the model and enter its key.
          </li>
          <li>
            <b>An AI on your own computer</b>, with Ollama (<code>http://localhost:11434/v1</code>), LM Studio (<code>http://localhost:1234/v1</code>) or
            another OpenAI-compatible server: choose <b>Local / OpenAI server</b>. It suits short stories, privacy and trying things out. A 10 GB graphics card
            holds a model of about 12B with a 16,000-token context, so the Narrator sees much less of a long story. Set <b>Longest reply, in tokens</b> to about
            3000 and <b>Recent Messages</b> to 40, and raise the context length in the server itself (Ollama's default is small and cuts the prompt without
            saying so).
          </li>
        </ul>
        <h3>Pictures: your own ComfyUI is best</h3>
        <p>
          NovelForge draws a lot: the Cover, a portrait for each person, a scene picture whenever the scene changes, pictures you ask for and every redraw. On a
          paid image service each one costs money; on your own ComfyUI they are free.
        </p>
        <ul>
          <li>
            <b>Local (ComfyUI)</b>: give ComfyUI's address and choose its models. In Simple Mode, FLUX.2 or Qwen Image keep faces the same from picture to
            picture, as they can use the portraits; SD 1.5 and SDXL can't. If an AI on your own computer shares the graphics card, turn on{" "}
            <b>Free GPU memory after each picture</b>.
          </li>
          <li>
            <b>OpenRouter</b>: for when you have no graphics card for ComfyUI. Paste your key and choose an image AI.
          </li>
        </ul>
        <p>
          You can turn pictures off at any time with <b>Create new images</b>, and only draw the ones you ask for by turning off <b>Draw scene pictures</b>.
        </p>
      </>
    ),
  },
  {
    slug: "new",
    name: "Making a story",
    body: (
      <>
        <p>New Story has three steps. What you write stays in this browser tab, so a trip to Settings or a reload doesn't lose it.</p>
        <h3>1. World and Characters</h3>
        <ul>
          <li>
            <b>Theme</b>: the kind of story, such as High Fantasy, Cyberpunk or Horror, or your own.
          </li>
          <li>
            <b>World Brief</b>: your description of the world. A line is enough; more gives you more say. You can change it later in the Journal.
          </li>
          <li>
            <b>Your Character</b>: your PC's name, who they are and what they look like.
          </li>
          <li>
            <b>Important Characters</b>: up to ten people you want in the story, each with a name and a description. The world is built around them, and each
            gets a portrait.
          </li>
          <li>
            <b>Starting Hook</b>: the situation the story opens on. Turn it off and your PC simply starts in the world.
          </li>
        </ul>
        <p>
          Each box has {tool(DecideIcon, "Write")} when it's empty and {tool(DecideIcon, "Enhance")} when it isn't: the Narrator writes it or builds on your
          words, and <b>Undo</b> puts yours back. {tool(DecideIcon, "Pick for me")} fills every empty box at once and leaves the ones you wrote, and never
          touches Important Characters.
        </p>
        <h3>2. Art</h3>
        <p>
          Choose an <b>Art Style</b> for every picture in the story, or describe your own. Then draw your PC's portrait, each Important Character's and the
          Cover, or leave any of them to be drawn when the story begins. Each picture has:
        </p>
        <ul>
          <li>
            <b>Draw</b> or {tool(EditIcon, "Redraw")}: draw it from its prompt.
          </li>
          <li>{tool(RegenerateIcon, "Redo")}: write a new prompt from your choices as they are now, and draw it.</li>
          <li>{tool(RewriteIcon, "Nudge")}: draw it again with a few words of your own, such as "smiling".</li>
          <li>{tool(UploadIcon, "Upload")}: use a picture of your own (PNG, JPEG or WebP, up to 10 MB).</li>
        </ul>
        <h3>3. Your World</h3>
        <p>
          The Narrator builds the world: a spoiler-free overview of what your PC would know, while the rest stays secret for the story to reveal. Read it, then{" "}
          <b>Begin</b>, or <b>Regenerate</b> for a different world from the same choices. Your PC and pictures stay. Going back to change your choices discards
          this world.
        </p>
      </>
    ),
  },
  {
    slug: "play",
    name: "Playing",
    body: (
      <>
        <p>
          Each <b>Turn</b> is your move and the Narrator's reply, which appears as it's written. Write as your PC: what they do, what they say, or both. The
          Narrator plays everyone and everything else.
        </p>
        <h3>Free Text and Choices</h3>
        <p>
          The {tool(ChoicesIcon, "Choices")} button switches how you play. In <b>Free Text</b> you type your move. In <b>Choices</b>, every reply ends with
          three things your PC might do; pick one to send it, or type your own in the box under them. Switch whenever you like. Continue, Decide for me and
          Enhance are only in Free Text.
        </p>
        <h3>The tools by the box</h3>
        <ul>
          <li>
            {tool(SendIcon, "Send")}, or Enter: send your move. Shift+Enter starts a new line. {tool(StopIcon, "Stop")} halts a reply while it's being written.
          </li>
          <li>{tool(ContinueIcon, "Continue")}: send nothing and let the Narrator move the story on by itself.</li>
          <li>
            {tool(DecideIcon, "Decide for me")} (with the box empty): the Narrator suggests a move for your PC, for you to send or change. With words in the box
            it becomes {tool(DecideIcon, "Enhance")}, which polishes what you wrote; <b>Undo</b> puts your words back.
          </li>
          <li>
            {tool(AskIcon, "Ask the Narrator")}: an out-of-character question, like asking a game master, such as "Would my character know this lord?" It is
            answered only from what your PC would know, changes nothing, and is forgotten.
          </li>
          <li>{tool(DrawIcon, "Draw a picture")}: describe a picture and it's drawn from your words and the recent story.</li>
          <li>
            {tool(RewriteIcon, "Tell Narrator what to change")}: change the world in your own words. See {link("fix", "Changing the story")}.
          </li>
        </ul>
        <h3>Luck and risk</h3>
        <p>
          An AI tends to be agreeable: left to itself, it lets nearly everything your PC tries work, and a story where nothing can fail soon goes flat. So
          NovelForge brings in real chance. When your PC tries something that could fail, the Narrator sets how hard it is before anyone knows the outcome, then
          a hidden die is rolled, and the Narrator writes what the roll decides.
        </p>
        <p>
          You never see the roll, only how things turn out. A bold plan can go wrong, a long shot can come off, and a well-chosen move gives you better odds.
        </p>
        <h3>Chapters</h3>
        <p>
          The story is divided into <b>Chapters</b>, which you read as a whole in the Journal. Only you end one: use {tool(ChapterIcon, "End the chapter here")}{" "}
          under the latest Message, or accept when the Narrator suggests a good place to stop. The next Chapter begins at once.
        </p>
        <h3>Leaving</h3>
        <p>
          You can go to the Menu, close the tab, or with the Server open the story on another device, at any time. A reply that's being written carries on and
          is there when you come back.
        </p>
      </>
    ),
  },
  {
    slug: "fix",
    name: "Changing the story",
    body: (
      <>
        <p>Nothing is final. The tools under a Message let you change what happened.</p>
        <h3>The latest reply</h3>
        <ul>
          <li>{tool(RewriteIcon, "Rewrite")}: tell the Narrator what to change, such as "she wouldn't give up that easily", and it writes the reply again.</li>
          <li>{tool(EditIcon, "Edit")}: change the words yourself. The Narrator brings the world in line with your version and writes nothing new.</li>
          <li>
            {tool(RegenerateIcon, "Regenerate")}: a fresh reply to the same move, with no guidance. {tool(RegenerateIcon, "Regenerate with Choices")} writes it
            again with three Choices, when a reply came without them.
          </li>
        </ul>
        <h3>Earlier Messages</h3>
        <ul>
          <li>{tool(RevertIcon, "Revert to here")}: go back to that Message and delete everything after it, for good.</li>
          <li>
            {tool(EditIcon, "Edit and replay from here")} (on your own Messages): change what you wrote and play the story again from there. Everything after it
            goes.
          </li>
          <li>
            {tool(DuplicateIcon, "Duplicate from here")}: keep this story as it is, and carry on from that Message in a new Save. This is how you try another
            path.
          </li>
        </ul>
        <h3>Changing the world</h3>
        <p>
          By the box, or in the Journal, {tool(RewriteIcon, "Tell Narrator what to change")} takes a change in your own words, such as "The king has a twin" or
          "My PC lost the sword in the river". The Narrator updates the world's secrets and the Journal to match, and the story carries on from there.
        </p>
      </>
    ),
  },
  {
    slug: "journal",
    name: "The Journal",
    body: (
      <>
        <p>
          The Journal is what your PC knows, kept up to date by the Narrator as you play. It never holds the world's secrets. You can change its text with{" "}
          {tool(EditIcon, "Edit")}, and your edit lasts unless you Revert to before it.
        </p>
        <ul>
          <li>
            <b>Story Time</b>: the date and time of day in the story, in the world's own calendar. Correct it if it's wrong.
          </li>
          <li>
            <b>World Brief</b>: your description of the world, which you can change.
          </li>
          <li>
            <b>Story Summary</b> and <b>Recent summary</b>: the story so far, and what just happened.
          </li>
          <li>
            <b>Loose Ends</b>: what your PC knows is still unsettled, such as promises, plans and open questions. Add, change or remove them.
          </li>
          <li>
            <b>What your PC knows</b>: the facts your PC has learned so far. Add, change or remove them.
          </li>
          <li>
            <b>Characters</b>: everyone your PC has met, with what your PC knows of them. {tool(RenameIcon, "Rename")} changes a name everywhere in the story.
          </li>
          <li>
            <b>Old Memories</b>: short accounts of older parts of the story. The Narrator only sees the newest Messages in full, and these are how it remembers
            the rest. Fix one if it gets something wrong.
          </li>
          <li>
            <b>Chapters</b>: read the story a Chapter at a time, and rename them.
          </li>
        </ul>
      </>
    ),
  },
  {
    slug: "pictures",
    name: "Pictures and the Gallery",
    body: (
      <>
        <p>With an image AI set up, pictures come by themselves:</p>
        <ul>
          <li>
            <b>Scene pictures</b> when the scene changes, shown in the story beside the reply.
          </li>
          <li>
            <b>Portraits</b> of each person your PC meets, and of your PC. With <b>Update portraits as the story goes</b> on, a portrait is redrawn when
            someone's look changes, keeping their face.
          </li>
          <li>
            <b>Pictures you ask for</b> with Draw a picture.
          </li>
        </ul>
        <p>
          Every picture in a story is in its <b>Gallery</b>: the Cover, the Characters and the Scenes. Open a picture to read and change the prompt it was drawn
          from, then:
        </p>
        <ul>
          <li>{tool(EditIcon, "Redraw")}: draw it again from its prompt.</li>
          <li>{tool(RegenerateIcon, "Update")} (the Cover and portraits): write a new prompt from the story as it stands, and draw it.</li>
          <li>{tool(RewriteIcon, "Nudge")} (the Cover and portraits): draw it again with a few words of your own.</li>
          <li>{tool(UploadIcon, "Upload")} (the Cover and portraits): replace it with a picture of your own.</li>
          <li>{tool(DeleteIcon, "Delete")} (scene pictures only): it's gone for good, and a Revert doesn't bring it back.</li>
        </ul>
        <p>Change a story's Art Style in Settings while the story is open. Pictures already drawn keep theirs until you redraw them.</p>
      </>
    ),
  },
  {
    slug: "saves",
    name: "Saves",
    body: (
      <>
        <p>
          Each story is one Save, which saves itself after every Turn and every change. <b>Load Story</b> lists them, and from there you can:
        </p>
        <ul>
          <li>{tool(DuplicateIcon, "Duplicate")}: copy a Save, to branch a story or keep a backup before a risky move.</li>
          <li>{tool(ExportIcon, "Export")}: download a Save as one file, pictures and all, to back it up or move it to another computer.</li>
          <li>
            <b>Import a Save</b>: bring an exported Save back in.
          </li>
          <li>{tool(DeleteIcon, "Delete")}: remove a Save for good.</li>
        </ul>
        <h3>Where your files are</h3>
        <p>
          Saves, Settings and logs are kept beside the program on Windows and Linux, in the folder you unpacked NovelForge into, and in{" "}
          <code>~/Library/Application Support/NovelForge</code> on a Mac. The <code>Saves</code> folder holds one file per story. Copy the folder to back
          everything up.
        </p>
      </>
    ),
  },
  {
    slug: "settings",
    name: "Settings",
    body: (
      <>
        <p>Settings apply to every story, except This Story, which appears when you open Settings from inside a story.</p>
        <h3>Text</h3>
        <ul>
          <li>
            <b>Text provider, Server address, Text model, Text API key</b>: where your Narrator is. With OpenRouter, <b>Provider</b> and <b>Routing</b> choose
            who serves the model. See {link("models", "Choosing your AI")}.
          </li>
          <li>
            <b>Extra Narrator Instructions</b>: your own guidance for the Narrator in every story, such as "Keep replies short" or "No romance".
          </li>
          <li>
            <b>Longest reply, in tokens</b> and <b>in minutes</b>: limits on one reply.
          </li>
          <li>
            <b>Recent Messages sent to the Narrator</b>: how many of the newest Messages it reads in full. More remembers more but costs more; older ones are
            remembered through Old Memories.
          </li>
          <li>
            <b>Longest Question answer, in words</b>: for Ask the Narrator.
          </li>
          <li>
            <b>Test text</b>: sends a short prompt to check the AI works. A paid provider may charge for it.
          </li>
        </ul>
        <h3>Images</h3>
        <ul>
          <li>
            <b>Create new images</b>: turn drawing on or off. Pictures you have stay.
          </li>
          <li>
            <b>Open new pictures in the story</b>: show new pictures open, or folded away.
          </li>
          <li>
            <b>Draw scene pictures</b> and <b>Update portraits as the story goes</b>: which pictures come by themselves.
          </li>
          <li>
            <b>Extra Image Instructions</b>: your own guidance for every picture.
          </li>
          <li>
            <b>Image provider</b>, its models and <b>Resolution</b>, and <b>Test image</b>. With ComfyUI, <b>Free GPU memory after each picture</b> lets other
            programs use the graphics card.
          </li>
        </ul>
        <h3>Reading</h3>
        <ul>
          <li>
            <b>Theme</b>: light, dark, or matching this device.
          </li>
          <li>
            <b>Chat style</b>: how the story looks: Script, Prose or Bubbles.
          </li>
          <li>
            <b>Font size</b>: small, medium or large.
          </li>
        </ul>
        <h3>This Story</h3>
        <p>How you play this story, Free Text or Choices, and its Art Style.</p> <h3>Updates</h3>
        <p>
          The version you have, <b>Check now</b> to look for a new one, and <b>Install</b> when there is one. See {link("updates", "Updates")}.
        </p>
        <h3>Advanced</h3>
        <p>
          <b>Log Level</b>: how much goes in the log in the <code>logs</code> folder. Raise it to Verbose to trace a problem. The log never holds your story's
          text or your keys.
        </p>
      </>
    ),
  },
  {
    slug: "devices",
    name: "Other devices",
    body: (
      <>
        <p>
          The <b>NovelForge</b> download is for one computer: it opens in your browser and only that computer can reach it. Choose <b>Quit</b> on the Menu to
          close it, or it closes by itself a few minutes after its last page.
        </p>
        <p>
          The <b>NovelForge Server</b> download serves your whole home network, so you can play from a phone or tablet. Start it, then browse to one of the
          addresses it shows, such as <code>http://192.168.1.20:4600/</code>. It keeps running until you close its window.
        </p>
        <p>
          <b>The Server has no accounts.</b> Anyone who can reach it can play, change Settings and spend your saved keys. Keep it on a network you trust.
        </p>
      </>
    ),
  },
  {
    slug: "updates",
    name: "Updates",
    body: (
      <>
        <p>
          When a new version is out, a notice says so at the top of whatever screen you're on. Press <b>Install</b>: NovelForge downloads it, restarts and comes
          back to the same page. Your stories and Settings stay as they are. If the new version won't start, the old one comes back. Press × to put it off, and
          the notice stays away until the next version.
        </p>
        <p>
          To check, NovelForge asks GitHub for the newest release every few hours. That is the only thing it sends anywhere besides your AI.{" "}
          <b>Settings → Updates</b> shows the version you have, checks at once with <b>Check now</b>, and offers Install too.
        </p>
        <p>
          If you run NovelForge from its source code, update with <code>git pull</code> and <code>bun install</code> instead.
        </p>
      </>
    ),
  },
  {
    slug: "help",
    name: "Questions and problems",
    body: (
      <>
        <h3>What does it cost?</h3>
        <p>
          NovelForge is free. You pay your text and image providers for what you use, usually pennies a Turn for text. Pictures on ComfyUI are free; on a paid
          service each one costs. Your provider's site shows what you've spent.
        </p>
        <h3>Who sees my story?</h3>
        <p>
          Your stories stay on your computer. Each Turn sends the story to the AI you chose, and picture prompts to your image AI. With AI on your own computer,
          nothing leaves your computer at all.
        </p>
        <h3>A Turn failed</h3>
        <p>
          The error says why, and your move stays in the box to send again. Check your key and credit with the provider, and press Test text in Settings. An AI
          that refuses some content says so: Rewrite or change your move, or choose a different AI.
        </p>
        <h3>Replies are slow, or cut off</h3>
        <p>
          An AI on your own computer can take a minute a Turn. Raise <b>Longest reply, in tokens</b> if replies end early, or <b>in minutes</b> if a slow AI
          times out.
        </p>
        <h3>The Narrator forgot something</h3>
        <p>
          It reads only the newest Messages in full, and remembers the rest through Old Memories, the summaries and the Journal. Correct those in the Journal,
          or tell it with Tell Narrator what to change. A bigger <b>Recent Messages</b> helps, at more cost per Turn.
        </p>
        <h3>No pictures appear</h3>
        <p>
          Check <b>Create new images</b> is on and press <b>Test image</b> in Settings. For ComfyUI, make sure it is running, and that the models you chose are
          still there. Scene pictures come only when the scene changes; use Draw a picture for more.
        </p>
        <h3>Windows or macOS won't open it</h3>
        <p>
          The downloads aren't signed yet. On Windows choose <b>More info</b>, then <b>Run anyway</b>. On a Mac, open{" "}
          <b>System Settings → Privacy &amp; Security</b> and choose <b>Open Anyway</b> beside NovelForge.
        </p>
        <h3>Something else</h3>
        <p>
          Report it on{" "}
          <a href="https://github.com/brianh014/novelforge/issues" target="_blank" rel="noreferrer">
            GitHub
          </a>
          , with what you did and what happened. The log in the <code>logs</code> folder helps, and holds no story text or keys.
        </p>
      </>
    ),
  },
];

export function Guide({ section }: { section?: string }) {
  const shown = SECTIONS.find(({ slug }) => slug === section) ?? SECTIONS[0]!;
  return (
    <Sheet
      view={shown.slug}
      tabs={<MenuRibbon />}
      rail={
        <>
          <h1 className="big">Reader's Guide</h1>
          <nav aria-label="Guide sections">
            {SECTIONS.map(({ slug, name }) => (
              <a key={slug} href={`#/guide/${slug}`} aria-current={slug === shown.slug ? "page" : undefined}>
                {name}
              </a>
            ))}
          </nav>
        </>
      }
    >
      <article className="guide">
        <h2>{shown.name}</h2>
        {shown.body}
      </article>
    </Sheet>
  );
}
