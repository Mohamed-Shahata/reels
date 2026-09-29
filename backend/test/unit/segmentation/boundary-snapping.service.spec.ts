import { BoundarySnappingService } from '../../../src/segmentation/boundary-snapping.service';

describe('BoundarySnappingService', () => {
  const service = new BoundarySnappingService();

  const topics = [
    { title: 'One', startSec: 0, endSec: 22, summary: 'First topic.' },
    { title: 'Two', startSec: 22, endSec: 41, summary: 'Second topic.' },
    { title: 'Three', startSec: 41, endSec: 60, summary: 'Third topic.' },
  ];

  it('snaps shared topic boundaries to nearest transcript sentence ends', () => {
    const snapped = service.snap(
      topics,
      [
        { startSec: 0, endSec: 8, text: 'Welcome.' },
        { startSec: 8, endSec: 18, text: 'First useful idea.' },
        { startSec: 18, endSec: 29, text: 'Continuing the same idea' },
        { startSec: 29, endSec: 40, text: 'Second useful idea؟' },
        { startSec: 40, endSec: 60, text: 'Closing.' },
      ],
      60,
    );

    expect(snapped.map((topic) => [topic.startSec, topic.endSec])).toEqual([
      [0, 18],
      [18, 40],
      [40, 60],
    ]);
  });

  it('uses transcript segment ends when punctuation is unavailable', () => {
    const snapped = service.snap(
      [
        { title: 'One', startSec: 0, endSec: 12, summary: 'First topic.' },
        { title: 'Two', startSec: 12, endSec: 30, summary: 'Second topic.' },
      ],
      [
        { startSec: 0, endSec: 10, text: 'no punctuation' },
        { startSec: 10, endSec: 20, text: 'still no punctuation' },
      ],
      30,
    );

    expect(snapped[0].endSec).toBe(10);
    expect(snapped[1].startSec).toBe(10);
  });

  it('rejects topic lists that are not contiguous full-video coverage', () => {
    expect(() =>
      service.snap(
        [
          { title: 'One', startSec: 2, endSec: 20, summary: 'First topic.' },
          { title: 'Two', startSec: 20, endSec: 60, summary: 'Second topic.' },
        ],
        [],
        60,
      ),
    ).toThrow(/full video/);

    expect(() =>
      service.snap(
        [
          { title: 'One', startSec: 0, endSec: 20, summary: 'First topic.' },
          { title: 'Two', startSec: 25, endSec: 60, summary: 'Second topic.' },
        ],
        [],
        60,
      ),
    ).toThrow(/contiguous/);
  });
});
