import React from "react";
import { AbsoluteFill, Audio, Composition, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import "./fonts";
import { Caption, Sheet } from "./components/kit";
import { FPS, SceneId, SceneTiming, TIMELINE, sceneById } from "./timeline";
import { Question } from "./scenes/Question";
import { Film } from "./scenes/Film";
import { Models } from "./scenes/Models";
import { Answer, Build, Close, Design } from "./scenes/Guide";
import { prog, easeDraw } from "./anim";
import media from "./data/media.json";
import { Thumbnail } from "./Thumbnail";
import { Cut, TOTAL } from "./Cut";
import { HowItWorks, HIW_DURATION, HIW_FPS } from "./HowItWorks";

const SCENE_VIEW: Record<SceneId, { name: string; C: React.FC<{ scene: SceneTiming }> }> = {
  question: { name: "The question", C: Question },
  film: { name: "Film it once", C: Film },
  models: { name: "The Meta models", C: Models },
  answer: { name: "Answer", C: Answer },
  design: { name: "Design", C: Design },
  build: { name: "Build", C: Build },
  close: { name: "basementready.com", C: Close },
};

// Every voice line, in video frames, for captions and for ducking the music under the voice.
const VOICE = TIMELINE.scenes.flatMap((s) => s.lines.map((l) => ({ ...l, at: s.from + l.from })));

// The music starts so its lift (media.lift seconds into public/music.wav) lands as the verdict stamp lands.
const MUSIC_AT = Math.max(0, sceneById("answer").from + Math.round(0.75 * FPS) - Math.round(media.lift * FPS));

const duck = (f: number) => {
  // 1 with no voice; about 12 dB under the voice while a line plays. It stays down through the short
  // pauses between lines (no pumping) and comes back up over a second in the longer ones.
  const UNDER = 0.32;
  let level = 1;
  for (const v of VOICE) {
    const a = v.at - 10, b = v.at + v.dur + 26;
    if (f < a - 14 || f > b + 30) continue;
    const down = interpolate(f, [a - 14, a, b, b + 30], [1, UNDER, UNDER, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    level = Math.min(level, down);
  }
  return level;
};

const SceneFade: React.FC<{ dur: number; children: React.ReactNode; first: boolean; last: boolean }> = ({ dur, children, first, last }) => {
  const frame = useCurrentFrame();
  const o = Math.min(first ? 1 : prog(frame, 0, 10), last ? 1 : 1 - prog(frame, dur - 10, 10, easeDraw));
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

export const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const current = TIMELINE.scenes.find((s) => frame >= s.from && frame < s.from + s.duration) ?? TIMELINE.scenes[TIMELINE.scenes.length - 1];
  const total = TIMELINE.total;
  return (
    <Sheet name={SCENE_VIEW[current.id].name} index={current.index + 1} of={TIMELINE.scenes.length}>
      {TIMELINE.scenes.map((s, i) => {
        const View = SCENE_VIEW[s.id].C;
        return (
          <Sequence key={s.id} from={s.from} durationInFrames={s.duration + (i === TIMELINE.scenes.length - 1 ? 0 : 10)}>
            <SceneFade dur={s.duration + 10} first={i === 0} last={i === TIMELINE.scenes.length - 1}>
              <View scene={s} />
            </SceneFade>
          </Sequence>
        );
      })}
      {VOICE.map((v) => (
        <Sequence key={v.id} from={v.at} durationInFrames={v.dur + 14}>
          {media.voice && <Audio src={staticFile(`voice/${v.id}.wav`)} />}
          <Caption text={v.text} dur={v.dur} />
        </Sequence>
      ))}
      {media.music && (
        <Sequence from={MUSIC_AT}>
          <Audio
            src={staticFile("music.wav")}
            volume={(f) => {
              const g = f + MUSIC_AT;
              return 0.25 * duck(g) * interpolate(g, [MUSIC_AT, MUSIC_AT + 75, total - 90, total - 5], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            }}
          />
        </Sequence>
      )}
    </Sheet>
  );
};

export const Root: React.FC = () => (
  <>
    <Composition id="Demo" component={Cut} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
    <Composition id="DemoExample" component={Demo} durationInFrames={TIMELINE.total} fps={FPS} width={1920} height={1080} />
    <Composition id="HowItWorks" component={HowItWorks} durationInFrames={HIW_DURATION} fps={HIW_FPS} width={1920} height={1080} />
    <Composition id="Thumbnail" component={Thumbnail} durationInFrames={1} fps={FPS} width={1280} height={720} />
  </>
);
