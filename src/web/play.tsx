import { type FormEvent, type KeyboardEvent, type ReactNode, type Ref, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  askNarrator,
  stopTurn,
  decideForMe,
  duplicateFrom,
  failureMessage,
  getMessages,
  getTurn,
  resumeTurn,
  type TurnStatus,
  getImages,
  getJournal,
  getChapters,
  closeChapter,
  getRequestedImages,
  getSave,
  imageUrl,
  type OpenSave,
  getSettings,
  type Message,
  playOpening,
  playTurn,
  type Journal,
  type Portrait,
  portraitUrl,
  previewRevert,
  replaceResponse,
  editResponse,
  type RequestedImage,
  type RequestedImages,
  requestedImageUrl,
  requestImage,
  revert,
  type SceneImageInfo,
  type SceneImages,
  setupProblem,
  storyName,
  takeImageFailure,
  type TurnResult,
} from "./api";
import { type Beat, BeatLine, type ChatStyle, messageBeats, openingBeat, readable, type StageBeat, stageBeats, type TurnInProgress } from "./chat-style";
import { CONTINUE_INPUT } from "../prompt-assembler";
import { AskIcon, StopIcon, ChapterIcon, ContinueIcon, DecideIcon, DownIcon, DrawIcon, DuplicateIcon, EditIcon, RegenerateIcon, RevertIcon, RewriteIcon, SendIcon } from "./icons";
import { TellTheNarrator } from "./journal";
import { Book, BookTabs, Fold, leftFolded, MoreBelow, rememberLeftFolded } from "./menu";
import { firstMove, type RunningTurn, runningTurn, startTurn, takeMissedFailure } from "./turns";
import { Person, Zoomable } from "./zoom";

const RECENT_LOOSE_ENDS = 3;

// Often enough to feel prompt, as an image takes many seconds anyway.
export const IMAGE_CHECK_MS = 2000;

const WRITING = "The Narrator is writing…";

export function SceneImage({ id, image, onLoad }: { id: string; image: SceneImageInfo; onLoad?: () => void }) {
  return (
    <figure className="plate">
      <Zoomable lazy src={imageUrl(id, image)} alt={image.caption ? `Scene Image: ${image.caption}` : "Scene Image"} onLoad={onLoad} />
      {image.caption && <figcaption aria-hidden="true">{image.caption}</figcaption>}
    </figure>
  );
}

const requestedAlt = ({ caption }: RequestedImage) => `Picture: ${caption}`;

export function RequestedPicture({ id, image }: { id: string; image: RequestedImage }) {
  return (
    <figure className="plate">
      <Zoomable lazy src={requestedImageUrl(id, image)} alt={requestedAlt(image)} />
      <figcaption aria-hidden="true">{image.caption}</figcaption>
    </figure>
  );
}

export function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.form!.requestSubmit();
}

/**
 * A new Turn snaps the player's words to the top of the story, and the response streams in below them, held there to
 * read at the player's pace. Blank room under the text lets a short Turn reach the top, and shrinks as text takes its
 * place, so nothing moves. The story's reversed layout means a scrollTop of 0 is the bottom.
 */
function useTurnScroll(story: RefObject<HTMLDivElement | null>, turn: unknown, latestId: number | undefined, inlineCount: number, folded: boolean) {
  const [more, setMore] = useState(false);
  const room = useRef<HTMLDivElement>(null);
  const following = useRef(false);
  const held = useRef(0);
  const inTurn = useRef(false);
  const startedOn = useRef(latestId);
  // The response the blank room belongs to, which stays for images that land under it after the Turn.
  const heldOn = useRef<number | undefined>(undefined);
  // Where the words sit on screen during a Turn, to put them back as it ends.
  const wordsAt = useRef(0);

  const checkMore = () => setMore(!!room.current && -story.current!.scrollTop > 8);

  // Only a move this code didn't make is the player's: a tap, or a wheel with nowhere to go, leaves the hold alone.
  function onScroll() {
    if (Math.abs(story.current!.scrollTop - held.current) > 2) following.current = false;
    if (inTurn.current) wordsAt.current = wordsIn(story.current!).getBoundingClientRect().top;
    checkMore();
  }

  // The Opening has no player words, and starts at the top.
  const wordsIn = (area: HTMLElement) => [...area.querySelectorAll(".message.player")].at(-1) ?? area.querySelector(".message.narrator")!;

  /** Sizes the room to what the text leaves, so a change below the words takes room from it instead of moving them. */
  function fitRoom(area: HTMLElement) {
    const anchor = wordsIn(area);
    const textHeight = room.current!.getBoundingClientRect().top - anchor.getBoundingClientRect().top;
    room.current!.style.height = `${Math.max(0, area.clientHeight - textHeight)}px`;
    return anchor;
  }

  useLayoutEffect(() => {
    const area = story.current;
    const wasInTurn = inTurn.current;
    if (turn && !wasInTurn) {
      following.current = true;
      startedOn.current = latestId;
    }
    inTurn.current = !!turn;
    if (area && room.current) {
      const finished = wasInTurn && !turn && latestId !== startedOn.current;
      if (finished) heldOn.current = latestId;
      // The room stays once a response ends, but a Revert leaves it nothing to hold.
      if (turn || latestId === heldOn.current) {
        const anchor = fitRoom(area);
        const fromAnchor = area.firstElementChild!.getBoundingClientRect().bottom - anchor.getBoundingClientRect().top;
        if (following.current) {
          area.scrollTop = -Math.max(0, fromAnchor - area.clientHeight);
          held.current = area.scrollTop;
        } else if (finished) {
          // The browser's scroll anchor can sit in the streamed text, and would ride it down as that text is replaced.
          area.scrollTop += anchor.getBoundingClientRect().top - wordsAt.current;
        }
        if (turn) wordsAt.current = anchor.getBoundingClientRect().top;
      } else {
        room.current.style.height = "0";
      }
    }
    if (!turn) following.current = false;
    checkMore();
  }, [turn, latestId, inlineCount, folded]);

  const refit = () => {
    if (latestId === heldOn.current) fitRoom(story.current!);
  };

  return { more, room, onScroll, refit };
}

const draftKey = (id: string) => `novelforge-draft-${id}`;

/** The chat bar's unsent words, kept for this tab so leaving the Story page doesn't lose them. Blocked storage only forgets them. */
function storedDraft(id: string) {
  try {
    return sessionStorage.getItem(draftKey(id)) ?? "";
  } catch {
    return "";
  }
}

function storeDraft(id: string, draft: string) {
  try {
    if (draft) sessionStorage.setItem(draftKey(id), draft);
    else sessionStorage.removeItem(draftKey(id));
  } catch {}
}

export function Play({ id }: { id: string }) {
  const [save, setSave] = useState<OpenSave>();
  const [folded, setFolded] = useState(leftFolded);
  const [messages, setMessages] = useState<Message[]>([]);
  const [images, setImages] = useState<SceneImages>({ images: [], pending: false, session: 0 });
  const [requested, setRequested] = useState<RequestedImages>({ images: [], drawing: 0 });
  const [imagesReady, setImagesReady] = useState(false);
  const [asking, setAsking] = useState(false);
  const [words, setWords] = useState("");
  const [setupNotice, setSetupNotice] = useState<string>();
  const [chatStyle, setChatStyle] = useState<ChatStyle>("prose");
  const [journal, setJournal] = useState<Journal>();
  // Portraits updated while the page is open, under the latest Message then. Only in memory, so a refresh clears them.
  const [updated, setUpdated] = useState<{ portrait: Portrait; messageId: number }[]>([]);
  const latestId = useRef<number>(undefined);
  const lastJournal = useRef<Journal>(undefined);
  latestId.current = messages.at(-1)?.id;
  const [openNewImages, setOpenNewImages] = useState(true);
  // Pictures each list held when first fetched. They stay folded, and only ones drawn later open by themselves.
  const loaded = useRef<Record<"scene" | "requested" | "portrait", Set<number>>>({} as never);
  // Unset until the player moves, so that each new response opens on its first beat.
  const [chosenBeat, setChosenBeat] = useState<number>();
  const [draft, setDraft] = useState(() => storedDraft(id));
  useEffect(() => storeDraft(id, draft), [id, draft]);
  const [turn, setTurn] = useState<TurnInProgress>();
  const [deciding, setDeciding] = useState(false);
  /** Ask the Narrator's field, and its one answer, which goes when the field closes or a Turn is sent. */
  const [questioning, setQuestioning] = useState(false);
  const [question, setQuestion] = useState("");
  const [telling, setTelling] = useState(false);
  const [answer, setAnswer] = useState("");
  const [wondering, setWondering] = useState(false);
  const askButton = useRef<HTMLButtonElement>(null);
  /** The player's words before an Enhance, which Undo puts back while the box still holds the Enhanced text. */
  const [enhanced, setEnhanced] = useState<{ was: string; now: string }>();
  // The response being rewritten, by id, so the box goes if the story moves on from it.
  const [rewriting, setRewriting] = useState<number>();
  // Whether that box holds the response's own words for an Edit, rather than feedback for a Rewrite.
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [reverting, setReverting] = useState<Message>();
  /** With a Revert to the Message before one of the player's: their words, to edit and send again from there. */
  const [replaying, setReplaying] = useState<string>();
  const [chapterOffer, setChapterOffer] = useState(false);
  const [endingChapter, setEndingChapter] = useState(false);
  const [closingChapter, setClosingChapter] = useState(false);
  const inputBox = useRef<HTMLTextAreaElement>(null);
  const story = useRef<HTMLDivElement>(null);
  const inlineCount = images.images.length + requested.images.length + (journal?.portraits.length ?? 0) + updated.length;
  const { more, room, onScroll, refit } = useTurnScroll(story, turn, messages.at(-1)?.id, inlineCount, folded);
  const rewriteButton = useRef<HTMLButtonElement>(null);
  const drawButton = useRef<HTMLButtonElement>(null);
  const leaving = useRef(new AbortController());
  const unwatchTurn = useRef(() => {});
  const imageCheck = useRef<ReturnType<typeof setTimeout>>(undefined);
  const duplicating = useRef(false);

  useEffect(() => {
    // Taken now, as it may finish while the page loads, and its Messages must not be missed.
    const inProgress = runningTurn(id);
    const missed = takeMissedFailure(id);
    // Without Settings the story still reads, in Prose.
    const reading = getSettings().catch(() => undefined);
    const live: Promise<TurnStatus> = inProgress ? Promise.resolve({}) : getTurn(id).catch(() => ({}));
    Promise.all([getSave(id), getMessages(id), reading, live]).then(([save, messages, settings, { running, failed }]) => {
      if (settings) {
        setSetupNotice(setupProblem(settings));
        setChatStyle(settings.chatStyle);
        setImagesReady(settings.imagesReady);
        setOpenNewImages(settings.openNewImages);
      }
      setSave(save);
      setMessages(messages);
      const failure = missed ?? (failed && { ...failed, error: failureMessage(failed) });
      if (failure) {
        setError(failure.error);
        giveBack(failure.input, failure.replaces);
      }
      const replaces = messages.find((message) => message.id === running?.replaces);
      const resumed =
        running && startTurn(id, { input: running.input, narration: running.narration, replaces }, (show) => resumeTurn(id, running, show));
      const move = firstMove({
        running: !!(inProgress || resumed),
        failure: !!failure,
        // Without a working Narrator this would only fail, and the page already says what to fix.
        unopened: messages.length === 0 && !!settings && !setupProblem(settings),
      });
      if (move === "follow") follow(inProgress ?? resumed!);
      else if (move === "open") openStory();
    }, (failure: Error) => setLoadError(failure.message));
    checkImages();
    checkChapter();
    return () => {
      leaving.current.abort();
      unwatchTurn.current();
      clearTimeout(imageCheck.current);
    };
  }, [id]);

  function takeJournal(next: Journal) {
    loaded.current.portrait ??= new Set(next.portraits.map(({ id }) => id));
    const before = lastJournal.current;
    lastJournal.current = next;
    const messageId = latestId.current;
    const redrawn = next.portraits.filter((portrait) => (before?.portraits.find(({ id }) => id === portrait.id)?.redraws ?? portrait.redraws) < portrait.redraws);
    if (messageId !== undefined && redrawn.length > 0) setUpdated((shown) => [...shown, ...redrawn.map((portrait) => ({ portrait, messageId }))]);
    setJournal(next);
  }

  function checkChapter() {
    getChapters(id).then(({ offer }) => setChapterOffer(offer), () => {});
  }

  async function endChapter() {
    setClosingChapter(true);
    try {
      await closeChapter(id);
      setEndingChapter(false);
      setChapterOffer(false);
      setAnnouncement("Chapter ended. The next Turn starts a new one.");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setClosingChapter(false);
    }
  }

  // Images draw in the background, so the page looks for them apart from the Turn, for as long as any are on the way.
  function checkImages() {
    clearTimeout(imageCheck.current);
    Promise.all([getImages(id), getRequestedImages(id)]).then(([next, asked]) => {
      loaded.current.scene ??= new Set(next.images.map(({ messageId }) => messageId));
      loaded.current.requested ??= new Set(asked.images.map(({ ref }) => ref));
      setImages(next);
      setRequested(asked);
      if (next.pending && !leaving.current.signal.aborted) imageCheck.current = setTimeout(checkImages, IMAGE_CHECK_MS);
      else {
        // Once, when drawing stops, as this holds the whole Full Log.
        getJournal(id).then(takeJournal, () => {});
        // Not on the way out, as nothing would be left to tell the player.
        if (leaving.current.signal.aborted) return;
        takeImageFailure(id).then((failure) => {
          if (!failure) return;
          setError(failure.error);
          setWords((typed) => typed || failure.words);
          setAsking(true);
        }, () => {});
      }
    }, () => {});
  }

  function send(event: FormEvent) {
    event.preventDefault();
    if (turn || deciding || !draft.trim()) return;
    setDraft("");
    playInput(draft, messages);
  }

  function continueStory() {
    if (turn || deciding || draft.trim()) return;
    playInput(CONTINUE_INPUT, messages);
  }

  function openStory() {
    run({ input: "", narration: "" }, [], (show, signal) => playOpening(id, show, signal));
  }

  async function decide() {
    if (turn || deciding) return;
    setDeciding(true);
    try {
      const was = draft.trim();
      const now = await decideForMe(id, was, leaving.current.signal);
      setEnhanced(was ? { was: draft, now } : undefined);
      setDraft(now);
      inputBox.current?.focus();
    } catch (failure) {
      if (!leaving.current.signal.aborted) setError((failure as Error).message);
    }
    setDeciding(false);
  }

  function replace(input: string) {
    // The control that asked for this goes with the response, and focus must not fall back to the page.
    story.current!.focus();
    playInput(input, messages.slice(0, -1), messages.at(-1));
  }

  function sendFeedback(event: FormEvent) {
    event.preventDefault();
    const replaces = messages.at(-1);
    if (!feedback.trim() || !replaces) return;
    if (!editing) return replace(feedback);
    story.current!.focus();
    // The edited words show while the Narrator catches the state up with them.
    run({ input: feedback, narration: feedback, replaces, edit: true }, messages.slice(0, -1), (_show, signal) => editResponse(id, replaces.id, feedback, signal));
  }

  function startRewrite(message: Message) {
    if (rewriting === message.id && !editing) return;
    setRewriting(message.id);
    setEditing(false);
    setFeedback("");
    setAsking(false);
  }

  function startEdit(message: Message) {
    if (rewriting === message.id && editing) return;
    setRewriting(message.id);
    setEditing(true);
    setFeedback(message.text);
    setAsking(false);
  }

  function cancelRewrite() {
    setRewriting(undefined);
    setEditing(false);
    setFeedback("");
    // Back in a Stage box can have taken the button away.
    (rewriteButton.current ?? story.current)?.focus();
  }

  function toggleAsking() {
    if (!drawable) return;
    setAsking(!asking);
    setRewriting(undefined);
    setQuestioning(false);
  }

  function toggleQuestioning() {
    if (!askable) return;
    setQuestioning(!questioning);
    setAsking(false);
    setRewriting(undefined);
  }

  function closeQuestion() {
    setQuestioning(false);
    setQuestion("");
    setAnswer("");
    askButton.current?.focus();
  }

  async function askQuestion(event: FormEvent) {
    event.preventDefault();
    if (!askable || wondering || !question.trim()) return;
    setError("");
    setWondering(true);
    try {
      setAnswer(await askNarrator(id, question, leaving.current.signal));
    } catch (failure) {
      if (!leaving.current.signal.aborted) setError((failure as Error).message);
    }
    setWondering(false);
  }

  function cancelAsking() {
    setAsking(false);
    setWords("");
    drawButton.current?.focus();
  }

  async function askForPicture(event: FormEvent) {
    event.preventDefault();
    if (!drawable) return;
    setError("");
    try {
      await requestImage(id, words);
      cancelAsking();
      checkImages();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  async function duplicateHere(message: Message) {
    if (duplicating.current) return;
    duplicating.current = true;
    try {
      location.hash = `/play/${(await duplicateFrom(id, message.id)).id}`;
    } catch (failure) {
      setError((failure as Error).message);
    }
    duplicating.current = false;
  }

  /** A failed Turn's text goes back where it was written, as feedback must never be sent as the PC's words. */
  function giveBack(input: string, replaces?: number, edit = false) {
    // A failed Continue leaves the box empty, so the Continue button is back to press again.
    if (replaces === undefined) setDraft(input === CONTINUE_INPUT ? "" : input);
    else if (input) {
      setRewriting(replaces);
      setEditing(edit);
      setFeedback(input);
    }
  }

  // `before` is passed in because the load effect runs this before `messages` is set.
  function playInput(input: string, before: Message[], replaces?: Message) {
    setQuestioning(false);
    setQuestion("");
    setAnswer("");
    return run({ input, narration: "", replaces }, before, (show, signal) =>
      replaces ? replaceResponse(id, replaces.id, input, show, signal) : playTurn(id, input, before.at(-1)?.id ?? 0, show, signal),
    );
  }

  function run(started: TurnInProgress, before: Message[], play: Parameters<typeof startTurn>[2]) {
    setError("");
    setAnnouncement("");
    setRewriting(undefined);
    setChosenBeat(undefined);
    follow(startTurn(id, started, play), before);
  }

  /** Shows a running Turn, which goes on without this screen. With no `before`, it was started on an earlier visit. */
  async function follow(running: RunningTurn, before?: Message[]) {
    unwatchTurn.current = running.watch(setTurn);
    const result = await running.finished;
    if (leaving.current.signal.aborted) return;
    unwatchTurn.current();
    const { replaces, narration, edit } = running.turn;
    if ("messages" in result) {
      const latest = before ? [...before, ...result.messages] : await getMessages(id).catch(() => result.messages);
      setTurn(undefined);
      setFeedback("");
      setMessages(latest);
      // Streamed text was already read out by the live region, and the Message list isn't live.
      if (!narration) setAnnouncement(result.messages.at(-1)!.text);
    } else {
      setTurn(undefined);
      giveBack(result.input, replaces?.id, edit);
      setError(result.error);
      // A stale Turn means the story moved on without this page.
      getMessages(id).then(setMessages, () => {});
    }
    checkChapter();
    checkImages();
  }

  // Before the story opens there's no Message for a picture to join.
  const drawable = imagesReady && !turn && messages.length > 0;
  const askable = !turn && messages.length > 0;

  if (loadError) {
    return (
      <Book left={<h1 className="big">NovelForge</h1>}>
        <p role="alert" className="error">{loadError}</p>
        <a className="quiet" href="#/">Main Menu</a>
      </Book>
    );
  }
  if (!save) return <Book left={null}>{null}</Book>;
  const pc = save.pc.name;
  const portraits = journal?.portraits ?? [];
  const portraitOf = (name?: string | null) => portraits.find(({ npc }) => npc === name);
  const latest = messages.at(-1);
  const replaceable = !turn && latest?.role === "narrator" ? latest : undefined;
  const scene = images.images.at(-1);
  const told = readable(turn?.replaces ? messages.slice(0, -1) : messages);
  const staged = chatStyle === "stage" && (told.length > 0 || !!turn);
  const sceneImage = (image = scene) => image && <SceneImage id={id} image={image} />;
  const opens = (list: keyof typeof loaded.current, key: number) => openNewImages && !loaded.current[list]?.has(key);
  /** Pictures the player asked for, which have no other place in the story. */
  const requestedRows = (message: Message) =>
    requested.images
      .filter(({ messageId }) => messageId === message.id)
      .map((image) => (
        <details key={image.ref} className="inline-image requested" open={opens("requested", image.ref)} onToggle={refit}>
          <summary>Picture: {image.caption}</summary>
          <Zoomable lazy src={requestedImageUrl(id, image)} alt={requestedAlt(image)} onLoad={refit} />
        </details>
      ));

  /** Folded in the story under the response they came with. */
  const inlineImages = (message: Message) => {
    const image = images.images.find(({ messageId }) => messageId === message.id);
    return (
      <>
        {image && (
          <details className="inline-image" open={opens("scene", image.messageId)} onToggle={refit}>
            <summary>Picture{image.caption && `: ${image.caption}`}</summary>
            {/* Only an open row loads its picture, and only then is its height known. */}
            <SceneImage id={id} image={image} onLoad={refit} />
          </details>
        )}
        {portraits
          .filter(({ npc, messageId }) => npc && messageId === message.id)
          .map((portrait) => (
            <details key={portrait.id} className="inline-image" open={opens("portrait", portrait.id)} onToggle={refit}>
              <summary>Portrait: {portrait.npc}</summary>
              <Zoomable className="portrait" lazy src={portraitUrl(id, portrait)} alt={portrait.npc!} onLoad={refit} />
            </details>
          ))}
        {updated
          .filter(({ messageId }) => messageId === message.id)
          .map(({ portrait }) => (
            <details key={`${portrait.id}/${portrait.redraws}`} className="inline-image" open={openNewImages} onToggle={refit}>
              <summary>Portrait updated: {portrait.npc ?? pc}</summary>
              <Zoomable className="portrait" lazy src={portraitUrl(id, portrait)} alt={portrait.npc ?? pc} onLoad={refit} />
            </details>
          ))}
        {requestedRows(message)}
      </>
    );
  };

  const line = (beat: Beat, key: number) => {
    const portrait = portraitOf(beat.speaker);
    return <BeatLine key={key} beat={beat} style={chatStyle} pc={pc} face={portrait && portraitUrl(id, portrait)} />;
  };

  const before = (message: Message) => messages[messages.indexOf(message) - 1];

  const controls = (message: Message) =>
    !turn && (
      <div className="row actions">
        {message.role === "player" && before(message) && (
          <button
            className="icon"
            title="Edit and replay from here"
            aria-label={`Edit and replay from your words: ${message.text.slice(0, 40)}`}
            onClick={() => {
              setReplaying(message.text === CONTINUE_INPUT ? "" : message.text);
              setReverting(before(message));
            }}
          >
            {EditIcon}
          </button>
        )}
        {message !== latest && (
          <button
            className="icon revert"
            title="Revert to here"
            aria-label={`Revert to this Message: ${message.text.slice(0, 40)}`}
            onClick={() => setReverting(message)}
          >
            {RevertIcon}
          </button>
        )}
        <button
          className="icon revert"
          title="Duplicate from here"
          aria-label={`Duplicate from this Message: ${message.text.slice(0, 40)}`}
          onClick={() => duplicateHere(message)}
        >
          {DuplicateIcon}
        </button>
        {message === latest && (
          <button className="icon" title="End the chapter here" aria-label="End the chapter here" aria-expanded={endingChapter} onClick={() => setEndingChapter(!endingChapter)}>
            {ChapterIcon}
          </button>
        )}
        {message === replaceable && (
          <>
            <button
              ref={rewriteButton}
              className="icon"
              title="Rewrite"
              aria-label="Rewrite"
              aria-expanded={rewriting === message.id}
              onClick={() => startRewrite(message)}
            >
              {RewriteIcon}
            </button>
            <button className="icon" title="Edit" aria-label="Edit" aria-expanded={rewriting === message.id && editing} onClick={() => startEdit(message)}>
              {EditIcon}
            </button>
            <button className="icon" title="Regenerate" aria-label="Regenerate" onClick={() => replace("")}>
              {RegenerateIcon}
            </button>
          </>
        )}
      </div>
    );

  return (
    <Book
      narrowLeft
      leftFolded={folded}
      left={
        <>
          <button
            type="button"
            className="icon left-toggle"
            title={folded ? "Open the left page" : "Fold the left page away"}
            aria-label="Left page"
            aria-expanded={!folded}
            onClick={() => {
              setFolded(!folded);
              rememberLeftFolded(!folded);
            }}
          >
            {DownIcon}
          </button>
          <Fold>
            {/* A Save from before titles has only its PC. */}
            <div className="story-title">
              <h1 className="title">{storyName(save)}</h1>
              {save.title && <p className="muted">{pc}</p>}
              {journal?.storyTime && <p className="muted">{journal.storyTime.date}, {journal.storyTime.timeOfDay}</p>}
            </div>
            {journal?.recentSummary && (
              <div className="story-recap">
                <h2>Recently</h2>
                <p>{journal.recentSummary}</p>
              </div>
            )}
            {!!journal?.looseEnds.length && (
              <div className="story-recap">
                <h2>Loose Ends</h2>
                <ul>
                  {journal.looseEnds.toReversed().slice(0, RECENT_LOOSE_ENDS).map((looseEnd) => (
                    <li key={looseEnd}>{looseEnd}</li>
                  ))}
                </ul>
                {journal.looseEnds.length > RECENT_LOOSE_ENDS && (
                  <a className="quiet" href={`#/journal/${id}`}>
                    More ({journal.looseEnds.length - RECENT_LOOSE_ENDS})
                  </a>
                )}
              </div>
            )}
            {!!journal?.recentNpcs.length && (
              <div className="story-recap">
                <h2>Recent Characters</h2>
                <ul className="people">
                  {journal.recentNpcs.map((name) => (
                    <li key={name} className="person">
                      <Person id={id} name={name} portrait={portraitOf(name)} who={journal.npcSummaries[name]} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Fold>
        </>
      }
      tabs={<BookTabs id={id} current="Story" />}
    >
      {staged ? (
        <StageBox
          story={story}
          beats={stageBeats(told, turn)}
          chosen={chosenBeat}
          onChoose={setChosenBeat}
          line={line}
          controls={controls}
          rows={requestedRows}
          waiting={!!turn && !(turn.edit && turn.narration)}
          retry={turn?.retry}
        >
          {/* Back should show what that moment looked like, not the newest image. */}
          {(message) => sceneImage(message && images.images.findLast(({ messageId }) => messageId <= message.id))}
        </StageBox>
      ) : (
        <div className="story-view">
          <div
            ref={story}
            className={`story chat-${chatStyle}`}
            tabIndex={0}
            role="region"
            aria-label="Story"
            onScroll={onScroll}
          >
            <div>
              {messages.length === 0 && !turn && (
                <>
                  <p className="muted">{save.startingHook || "The page is blank."}</p>
                  <button className="quiet" onClick={openStory}>
                    Have the Narrator open the story
                  </button>
                </>
              )}
              {told.map((message) => (
                <div key={message.id} className={`message ${message.role}`}>
                  {messageBeats(message).map(line)}
                  {controls(message)}
                  {inlineImages(message)}
                </div>
              ))}
              {turn?.input && !turn.replaces && (
                <div className="message player">{messageBeats({ role: "player", text: turn.input }).map(line)}</div>
              )}
              {/* Mounted before any text arrives, or screen readers would not announce it. */}
              <div aria-live="polite" className="message narrator">
                {turn?.retry && <p className="notice">{turn.retry}</p>}
                {turn?.narration && messageBeats({ role: "narrator", text: turn.narration }).map(line)}
                {/* Until the Turn is done, as the text can pause while the Narrator writes the rest of its reply. An Edit has its own. */}
                {turn && !(turn.edit && turn.narration) && <p className="waiting">{WRITING}</p>}
              </div>
              <div ref={room} aria-hidden="true" />
            </div>
          </div>
          {more && (
            // The story's reversed layout puts its newest text at 0.
            <MoreBelow onClick={() => story.current!.scrollTo({ top: 0 })} />
          )}
        </div>
      )}
      <div className="visually-hidden" aria-live="polite">
        {staged && turn ? (
          turn.narration ? messageBeats({ role: "narrator", text: turn.narration }).map(line) : WRITING
        ) : (
          <p>{announcement}</p>
        )}
      </div>
      {setupNotice && (
        <p className="notice">
          {setupNotice} The Narrator can't reply until then. <a href={`#/settings/${id}`}>Open Settings</a>
        </p>
      )}
      {error && (
        <div role="alert" className="error dismissable">
          <p>{error}</p>
          <button type="button" className="quiet" aria-label="Dismiss this error" onClick={() => setError("")}>×</button>
        </div>
      )}
      {closingChapter ? (
        <p role="status" className="waiting">Ending the chapter…</p>
      ) : (
        !turn &&
        (endingChapter ? (
          <div className="ask">
            <p>End this chapter after the latest Message? The Narrator gives it a title, and the next Turn starts a new chapter.</p>
            <div className="row">
              <button type="button" className="quiet" onClick={() => setEndingChapter(false)}>
                Cancel
              </button>
              <button type="button" className="action" onClick={endChapter}>
                End the chapter
              </button>
            </div>
          </div>
        ) : (
          chapterOffer && (
            <div className="notice dismissable">
              <p>This feels like the end of a chapter.</p>
              <button type="button" className="quiet chapter-end" onClick={endChapter}>
                End the chapter
              </button>
              <button type="button" className="quiet" aria-label="Keep the chapter going" onClick={() => setChapterOffer(false)}>×</button>
            </div>
          )
        ))
      )}
      {/* An Edit shows its words at once, so this is all that says the Narrator is still at work. */}
      {turn?.edit && <p role="status" className="waiting">The Narrator is updating the story…</p>}
      {/* Pending covers every picture on the way, Scene Images and portraits too, and only requested ones are counted. */}
      {(images.pending || requested.drawing > 0) && (
        <p role="status" className="waiting">
          Drawing {DRAWING[images.drawing ?? ""] ?? "a picture"}
          {(images.more ?? 0) > 0 && `, then ${plural(images.more!, "more picture")}`}…
        </p>
      )}
      {replaceable && rewriting === replaceable.id && (
        <form className="ask" onSubmit={sendFeedback}>
          <label>
            {editing ? "Edit the response" : "What should the Narrator change?"}
            <textarea
              autoFocus
              rows={editing ? 10 : 2}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              // An Edit is many lines long, so Enter makes a new line.
              onKeyDown={editing ? undefined : sendOnEnter}
            />
          </label>
          <div className="row">
            <button type="button" className="quiet" onClick={cancelRewrite}>
              Cancel
            </button>
            <button className="action" aria-disabled={!feedback.trim()}>
              {editing ? "Save the edit" : "Rewrite the response"}
            </button>
          </div>
        </form>
      )}
      {asking && drawable && (
        <form className="ask" onSubmit={askForPicture}>
          <label>
            What should the picture show?
            <textarea
              autoFocus
              rows={2}
              maxLength={300}
              placeholder="Describe what you want or leave blank to draw the current scene"
              value={words}
              onChange={(e) => setWords(e.target.value)}
              onKeyDown={sendOnEnter}
            />
          </label>
          <div className="row">
            <button type="button" className="quiet" onClick={cancelAsking}>
              Cancel
            </button>
            <button className="action">
              Draw
            </button>
          </div>
        </form>
      )}
      {questioning && askable && (
        <form className="ask" onSubmit={askQuestion}>
          <label>
            What do you ask the Narrator?
            <textarea
              autoFocus
              rows={2}
              maxLength={1000}
              placeholder={`What would ${pc} know about this place?`}
              value={question}
              readOnly={wondering}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={sendOnEnter}
            />
          </label>
          {(wondering || answer) && <p role="status" className="answer">{wondering ? "The Narrator is thinking…" : answer}</p>}
          <div className="row">
            <button type="button" className="quiet" onClick={closeQuestion}>
              {answer ? "Close" : "Cancel"}
            </button>
            <button className="action" aria-disabled={wondering || !question.trim()}>
              Ask
            </button>
          </div>
        </form>
      )}
      <form className="compose" onSubmit={send}>
        <label>
          <span className="visually-hidden">What does {pc} say or do?</span>
          <textarea
            ref={inputBox}
            rows={1}
            placeholder={deciding ? "The Narrator is deciding…" : `What does ${pc} say or do?`}
            value={draft}
            // While deciding, the reply would overwrite anything typed.
            readOnly={!!turn || deciding}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={sendOnEnter}
          />
        </label>
        <div className="compose-actions">
          <button
            ref={drawButton}
            type="button"
            className="icon"
            title={drawable ? "Draw a picture" : `Draw a picture: ${imagesReady ? "wait for the story" : "images are off in Settings"}`}
            aria-label="Draw a picture"
            aria-expanded={asking && drawable}
            aria-disabled={!drawable}
            onClick={toggleAsking}
          >
            {DrawIcon}
          </button>
          <button
            ref={askButton}
            type="button"
            className="icon"
            title={askable ? "Ask the Narrator" : "Ask the Narrator: wait for the story"}
            aria-label="Ask the Narrator"
            aria-expanded={questioning && askable}
            aria-disabled={!askable}
            onClick={toggleQuestioning}
          >
            {AskIcon}
          </button>
          <button type="button" className="icon" title="Tell Narrator what to change" aria-label="Tell Narrator what to change" aria-haspopup="dialog" onClick={() => setTelling(true)}>
            {RewriteIcon}
          </button>
          <button
            type="button"
            className="icon"
            title={draft.trim() ? "Enhance what you wrote" : "Decide for me"}
            aria-label={draft.trim() ? "Enhance" : "Decide for me"}
            aria-disabled={!!turn || deciding}
            onClick={decide}
          >
            {DecideIcon}
          </button>
          {enhanced && enhanced.now === draft && (
            <button type="button" className="quiet" onClick={() => setDraft(enhanced.was)}>
              Undo
            </button>
          )}
          {deciding && !!draft.trim() && (
            <span role="status" className="waiting">
              Enhancing…
            </span>
          )}
          {!draft.trim() && (
            <button
              type="button"
              className="icon continue"
              title="Continue: the Narrator moves the story on"
              aria-label="Continue"
              aria-disabled={!!turn || deciding}
              onClick={continueStory}
            >
              {ContinueIcon}
            </button>
          )}
          {/* Not for the Opening, as a page with no Messages has nothing to start it again. */}
          {turn && messages.length > 0 ? (
            <button type="button" className="icon send" title="Stop the Narrator" aria-label="Stop" onClick={() => stopTurn(id).catch(() => {})}>
              {StopIcon}
            </button>
          ) : (
            // aria-disabled, because a disabled button would drop keyboard focus at every Send.
            <button className="icon send" title="Send" aria-label="Send" aria-disabled={!!turn || deciding || !draft.trim()}>
              {SendIcon}
            </button>
          )}
        </div>
      </form>
      {/* Outside the chat form, as the dialog holds a form of its own. */}
      {telling && <TellTheNarrator id={id} onDone={async () => {}} onClose={() => setTelling(false)} />}
      {reverting && (
        <RevertDialog
          id={id}
          message={reverting}
          replay={replaying}
          onClose={() => {
            setReverting(undefined);
            setReplaying(undefined);
          }}
          onReverted={(input) => {
            const kept = messages.filter((message) => message.id <= reverting.id);
            setMessages(kept);
            setChosenBeat(undefined);
            checkChapter();
            getJournal(id).then(takeJournal, () => {});
            checkImages();
            // The button that opened the dialog goes with the Messages, and focus must not fall back to the page.
            inputBox.current!.focus();
            if (input) playInput(input, kept);
          }}
        />
      )}
    </Book>
  );
}

/** One beat shows at a time. The rest stay in the DOM, visually hidden, so that a screen reader can reach them all. */
function StageBox(props: {
  story: Ref<HTMLDivElement>;
  beats: StageBeat[];
  chosen: number | undefined;
  onChoose: (beat: number) => void;
  line: (beat: Beat, key: number) => ReactNode;
  controls: (message: Message) => ReactNode;
  rows: (message: Message) => ReactNode;
  waiting: boolean;
  retry?: string;
  children: (message?: Message) => ReactNode;
}) {
  const { beats, chosen, onChoose, waiting } = props;
  const last = beats.length - 1;
  const at = Math.min(chosen ?? openingBeat(beats), last);
  const current = beats[at]!;
  return (
    <div ref={props.story} className="stage" tabIndex={-1} role="region" aria-label="Story">
      {props.children(current.message)}
      <div className="stage-box">
        {beats.map(({ beat, message }, index) =>
          index === at ? (
            // Focusable, because a long beat has to scroll by keyboard.
            <div key={index} className={beat.player ? "beat player" : "beat"} tabIndex={0}>
              {props.line(beat, index)}
            </div>
          ) : (
            // A Turn in progress is read out by the live region, so it mustn't be reached twice.
            <div key={index} className="visually-hidden" aria-hidden={!message}>
              {props.line(beat, index)}
            </div>
          ),
        )}
        {props.retry && <p className="notice">{props.retry}</p>}
        {waiting && <p className="waiting">{WRITING}</p>}
        {current.message && props.rows(current.message)}
        <div className="row stage-foot">
          <span className="muted">
            Beat {current.number} of {current.of}
          </span>
          <button className="quiet" aria-disabled={at === 0} onClick={() => at > 0 && onChoose(at - 1)}>
            Back
          </button>
          <button className="action" aria-disabled={at === last} onClick={() => at < last && onChoose(at + 1)}>
            Next
          </button>
        </div>
        {current.message && props.controls(current.message)}
      </div>
    </div>
  );
}

/** What the story says is being drawn, by the kind of job drawing it. */
const DRAWING: Record<string, string> = {
  scene: "the scene",
  portrait: "a portrait",
  requested: "the picture you asked for",
  "scene redraw": "a scene again",
  "requested redraw": "a picture again",
  "portrait redraw": "a portrait again",
  "cover redraw": "the Cover again",
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** With `replay`, the Revert goes to `message`, just before the player's words, and sends them again as edited. */
function RevertDialog(props: {
  id: string;
  message: Message;
  replay?: string;
  onClose: () => void;
  onReverted: (input?: string) => void;
}) {
  const { id, message, replay } = props;
  const [input, setInput] = useState(replay ?? "");
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<{ messages: number; images: number; portraits: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    dialog.current!.showModal();
    previewRevert(id, message.id).then(setPreview, (failure: Error) => setError(failure.message));
  }, [id, message.id]);

  async function attempt(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  }

  const confirmRevert = () =>
    attempt(async () => {
      await revert(id, message.id);
      // Gone if the player pressed Escape while this was in flight, and the Revert happened all the same.
      dialog.current?.close();
      props.onReverted(replay === undefined ? undefined : input.trim());
    });

  const duplicate = () =>
    attempt(async () => {
      location.hash = `/play/${(await duplicateFrom(id, message.id)).id}`;
    });

  return (
    <dialog ref={dialog} onClose={props.onClose} aria-labelledby="revert-title">
      {replay === undefined ? (
        <>
          <h2 id="revert-title">Revert to this Message?</h2>
          <blockquote>{message.text}</blockquote>
        </>
      ) : (
        <>
          <h2 id="revert-title">Edit and replay from here?</h2>
          <textarea aria-label="Your words" rows={4} value={input} onChange={(event) => setInput(event.target.value)} />
        </>
      )}
      {preview && replay !== undefined && (
        <p>
          Sending permanently deletes{" "}
          {preview.messages === 1 ? "this Message" : `this Message and the ${plural(preview.messages - 1, "Message")} after it`}
          {preview.images > 0 && ` and ${plural(preview.images, "image")}`}
          {preview.portraits > 0 && ` and ${plural(preview.portraits, "portrait")}`}, then the Narrator answers your new words.
        </p>
      )}
      {preview && replay === undefined && (
        <p>
          This permanently deletes the {plural(preview.messages, "Message")} after it
          {preview.images > 0 && ` and ${plural(preview.images, "image")}`}
          {preview.portraits > 0 && ` and ${plural(preview.portraits, "portrait")}`}.
        </p>
      )}
      {replay === undefined && <p className="muted">“Duplicate from here” keeps this story and carries on in a new Save instead.</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {/* Cancel comes first because a modal focuses its first control, and that must not be the deleting one. */}
      <div className="row">
        <button className="quiet" onClick={() => dialog.current!.close()}>
          Cancel
        </button>
        {replay === undefined && (
          <button className="quiet" disabled={busy || !preview} onClick={duplicate}>
            Duplicate from here
          </button>
        )}
        <button className="action" disabled={busy || !preview || (replay !== undefined && !input.trim())} onClick={confirmRevert}>
          {replay === undefined ? "Revert" : "Send"}
        </button>
      </div>
    </dialog>
  );
}
