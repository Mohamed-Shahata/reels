# Reframing Specification (Analyzer Service)

## Analyzer (Python service, stage `ANALYZE`)

Input: `{ videoId, proxyKey, audioKey, contentType, transcript speaker hints? }`. Output: `ReframePlan`.

1. **Face Detection & Tracking**: Sample frames (2 fps من الـ proxy 720p) → face detection (YuNet/MediaPipe) → face tracks (IoU tracking) بـ bbox لكل ثانية.
2. **SOLO**: اختار الـ track الأكبر/الأكثر ظهورًا. لكل clip يتحسب **crop ثابت**: median لمركز الوش على مدة الـ clip → قص عرض `ih*9/16` متمركز عليه (clamped). **مفيش حركة كاميرا أبدًا** ("الكاميرا ثابتة مكانها").
3. **PODCAST**: لازم track لشخصين (لو لقى واحد أو تلاتة → warning وfallback). تحديد المتكلم النشط بـ diarization (pyannote أو whisperx) على الـ audio → `speakerTurns[{speaker,start,end}]` وربط كل speaker بـ face track (الوش اللي حركة فمه بتتطابق مع الكلام، أو يمين/شمال لو الكاميرا ثابتة).
4. **Switching rules** (عشان ميبقاش مزعج): أقل مدة لقطة 1.5 ث، تجاهل الـ turns أقل من 0.8 ث (backchannel زي "أيوه")، cut مباشر (hard cut) مش pan، ولو الاتنين بيتكلموا فوق بعض لأكتر من 2 ث → اللقطة تفضل على المتكلم الأقدم.
5. **Fallback آمن (V1 minimum)**: لو الـ diarization فشل أو ثقته واطية → layout **stacked** (الشخصين فوق بعض، كل واحد نص الشاشة 1080×960). دا مش بيحتاج speaker detection، فالـ pipeline عمره ما يفشل بسبب دا.
6. **No faces fallback**: لو مفيش وشوش خالص → center crop.

> [!WARNING]
> **Spike إلزامي (Task 4.1):** جرّب 3–4 فيديوهات بودكاست حقيقية عربي. قيّم دقة الـ diarization والـ cut quality. لو مش كويس → V1 يطلع بـ stacked كـ default للـ PODCAST، والـ switching ينزل V1.1.
