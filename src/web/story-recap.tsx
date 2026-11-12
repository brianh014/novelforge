import type { Journal, OpenSave, Portrait } from "./api";
import { storyName } from "./api";
import { Person } from "./zoom";

const RECENT_LOOSE_ENDS = 3;

/** The left page beside the story: where and when it is, and what the player may want to remember. */
export function StoryRecap({
  id,
  save,
  journal,
  portraitOf,
}: {
  id: string;
  save: OpenSave;
  journal?: Journal;
  portraitOf: (name: string) => Portrait | undefined;
}) {
  return (
    <>
      {/* A Save from before titles has only its PC. */}
      <div className="story-title">
        <h1 className="title">{storyName(save)}</h1>
        {journal?.storyTime && (
          <p className="muted" data-testid="story-time">
            {journal.storyTime.date}, {journal.storyTime.timeOfDay}
          </p>
        )}
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
            {journal.looseEnds
              .toReversed()
              .slice(0, RECENT_LOOSE_ENDS)
              .map((looseEnd) => (
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
    </>
  );
}
