import logging
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("analyzer")

app = FastAPI(title="ReelCast Analyzer Service", version="1.0.0")


class TranscriptSegmentHint(BaseModel):
    startSec: float
    endSec: float
    speaker: Optional[str] = None


class AnalyzeRequest(BaseModel):
    videoId: str
    contentType: str = Field(default="SOLO")
    proxyUrl: Optional[str] = None
    durationSec: Optional[float] = 0.0
    segments: Optional[List[TranscriptSegmentHint]] = None


class FaceTrack(BaseModel):
    speaker: int
    label: str
    centerNormX: float
    centerNormY: float
    box: Dict[str, float]


class SpeakerTurn(BaseModel):
    speaker: int
    startSec: float
    endSec: float


class ReframePlanResponse(BaseModel):
    videoId: str
    version: int = 1
    contentType: str
    faces: List[FaceTrack]
    speakerTurns: Optional[List[SpeakerTurn]] = None


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "service": "analyzer"}


@app.post("/analyze", response_model=ReframePlanResponse)
def analyze(req: AnalyzeRequest) -> ReframePlanResponse:
    logger.info(f"Received analyze request for video {req.videoId} (type: {req.contentType})")

    content_type = req.contentType.upper()
    if content_type not in ["SOLO", "PODCAST"]:
        content_type = "SOLO"

    if content_type == "SOLO":
        # SOLO video: Single prominent centered face track.
        # Fixed 9:16 crop window centered on face median (norm center 0.5)
        faces = [
            FaceTrack(
                speaker=0,
                label="solo_speaker",
                centerNormX=0.5,
                centerNormY=0.4,
                box={"x": 0.35, "y": 0.2, "w": 0.3, "h": 0.4},
            )
        ]
        return ReframePlanResponse(
            videoId=req.videoId,
            version=1,
            contentType="SOLO",
            faces=faces,
            speakerTurns=None,
        )

    # PODCAST video: Two speakers (Left and Right).
    # Generates two face tracks and initial speaker turns for switching or stacked fallback.
    faces = [
        FaceTrack(
            speaker=0,
            label="speaker_left",
            centerNormX=0.3,
            centerNormY=0.4,
            box={"x": 0.15, "y": 0.2, "w": 0.3, "h": 0.4},
        ),
        FaceTrack(
            speaker=1,
            label="speaker_right",
            centerNormX=0.7,
            centerNormY=0.4,
            box={"x": 0.55, "y": 0.2, "w": 0.3, "h": 0.4},
        ),
    ]

    speaker_turns: List[SpeakerTurn] = []
    duration = req.durationSec if (req.durationSec and req.durationSec > 0) else 60.0

    # Build speaker turns from transcript segments if available, or alternating turns
    if req.segments and len(req.segments) > 0:
        for idx, seg in enumerate(req.segments):
            spk = 0 if (seg.speaker == "speaker_0" or idx % 2 == 0) else 1
            speaker_turns.append(
                SpeakerTurn(speaker=spk, startSec=round(seg.startSec, 2), endSec=round(seg.endSec, 2))
            )
    else:
        # Default alternating 15-second turns
        curr = 0.0
        active_speaker = 0
        turn_len = 15.0
        while curr < duration:
            end_turn = min(curr + turn_len, duration)
            speaker_turns.append(
                SpeakerTurn(speaker=active_speaker, startSec=round(curr, 2), endSec=round(end_turn, 2))
            )
            curr = end_turn
            active_speaker = 1 - active_speaker

    return ReframePlanResponse(
        videoId=req.videoId,
        version=1,
        contentType="PODCAST",
        faces=faces,
        speakerTurns=speaker_turns,
    )
