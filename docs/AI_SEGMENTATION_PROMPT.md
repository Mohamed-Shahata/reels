# AI Topic Segmentation Prompt

## Purpose

This prompt turns an ordered transcript window into useful, time-bounded podcast topics. It is designed for the Groq LLM integration planned in Phase 6.2. The model proposes semantic topics only; later phases reconcile window boundaries, validate lengths and persist AI clips.

## Input Contract

Provide one transcript window as JSON. `windowStartSec` and `windowEndSec` describe the valid time range for every returned topic. `segments` are ordered transcript segments with source timestamps.

```json
{
  "language": "ar",
  "videoDurationSec": 3600,
  "windowStartSec": 0,
  "windowEndSec": 420,
  "segments": [
    { "startSec": 0, "endSec": 8.4, "text": "اهلا بكم في الحلقة." },
    { "startSec": 8.4, "endSec": 23.2, "text": "النهاردة بنتكلم عن بناء عادات التواصل." }
  ]
}
```

## System Prompt

```text
You are an editor who identifies useful, self-contained podcast topics from a timestamped transcript.

Return only valid JSON that conforms exactly to the output schema. Do not add Markdown, prose, comments, explanations or keys that are not in the schema.

Use only information present in the transcript. Keep each topic within the supplied window and use timestamps from nearby transcript boundaries; never invent time ranges outside the window. Favor a clear idea, practical takeaway, story, question, or transition that can stand on its own. Write titles and summaries in the transcript language.

Return topics in chronological order. Avoid duplicate, overlapping, empty, promotional, and filler-only topics. A window may produce an empty list when it contains no meaningful topic. Do not force the first or last topic to cover the complete window; boundary reconciliation will handle adjacent windows.
```

## User Prompt Template

```text
Analyze this transcript window and return topic candidates.

<transcript_window>
{{TRANSCRIPT_WINDOW_JSON}}
</transcript_window>
```

## Strict Output Schema

The LLM response must be a JSON object with no additional properties. Each topic must contain all four fields and no additional properties.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["segments"],
  "properties": {
    "segments": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "startSec", "endSec", "summary"],
        "properties": {
          "title": { "type": "string", "minLength": 1, "maxLength": 120 },
          "startSec": { "type": "number", "minimum": 0 },
          "endSec": { "type": "number", "exclusiveMinimum": 0 },
          "summary": { "type": "string", "minLength": 1, "maxLength": 500 }
        }
      }
    }
  }
}
```

The application will additionally enforce `startSec < endSec`, window bounds, configured clip-length limits and non-overlap in later phases. These are intentionally not delegated to the model.

## Example

### Input

```json
{
  "language": "ar",
  "videoDurationSec": 3600,
  "windowStartSec": 0,
  "windowEndSec": 145,
  "segments": [
    { "startSec": 0, "endSec": 10, "text": "اهلا بكم. النهاردة هنتكلم عن ازاي نكسب ثقة الناس." },
    { "startSec": 10, "endSec": 42, "text": "اهم حاجة انك تسمع بتركيز قبل ما ترد، لان الناس بتحس لما تكون مستعجل تقول رأيك." },
    { "startSec": 42, "endSec": 78, "text": "اسأل سؤال متابعة بسيط، زي ايه اكتر حاجة مزعجاك في الموقف ده، وبعدها لخص اللي سمعته." },
    { "startSec": 78, "endSec": 112, "text": "الطريقة دي بتخلي الطرف التاني يحس انه مفهوم، وده بيبني ثقة حتى لو مش هتتفقوا في النهاية." },
    { "startSec": 112, "endSec": 145, "text": "بعد الفاصل هنتكلم عن ازاي ترفض طلب من غير ما تخسر العلاقة." }
  ]
}
```

### Expected Output

```json
{
  "segments": [
    {
      "title": "الاستماع هو بداية الثقة",
      "startSec": 10,
      "endSec": 112,
      "summary": "الاستماع بتركيز، وطرح سؤال متابعة، وتلخيص ما سمعته يجعل الطرف الآخر يشعر بأنه مفهوم ويبني الثقة."
    }
  ]
}
```
