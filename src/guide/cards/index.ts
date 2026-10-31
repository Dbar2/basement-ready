// The Build milestone's cards (track F), by kind, for src/guide/mount.tsx. Each takes the mount's
// CardProps, saves through the workspace API, then tells the guide what it saved:
// { type: "permitItem", itemId, value: { said } }.
import type { ComponentType } from "react";
import type { CardKind, CardProps } from "../mount";
import { BuildPathCard } from "./BuildPathCard";
import { DesignerCard } from "./DesignerCard";
import { DownloadCard } from "./DownloadCard";
import { MoneyQuestionCard } from "./MoneyQuestionCard";
import { OwnerCard } from "./OwnerCard";
import { TapeCard } from "./TapeCard";
import { UpstairsCard } from "./UpstairsCard";
import { WaterMeterCard } from "./WaterMeterCard";
import { WindowCard } from "./WindowCard";
import "./cards.css";

export const BUILD_CARDS: Record<CardKind, ComponentType<CardProps>> = {
  tape: TapeCard,
  window: WindowCard,
  owner: OwnerCard,
  waterMeter: WaterMeterCard,
  upstairs: UpstairsCard,
  designer: DesignerCard,
  moneyQuestion: MoneyQuestionCard,
  buildPath: BuildPathCard,
  download: DownloadCard,
};

export { BuildPathCard, DesignerCard, DownloadCard, MoneyQuestionCard, OwnerCard, TapeCard, UpstairsCard, WaterMeterCard, WindowCard };
