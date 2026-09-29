import { BoundaryReconciliationService } from '../../../src/segmentation/boundary-reconciliation.service';

describe('BoundaryReconciliationService', () => {
  const service = new BoundaryReconciliationService();

  it('creates contiguous coverage for overlapping and gapped window results', () => {
    const reconciled = service.reconcile(
      [
        {
          title: 'Introduction',
          startSec: 10,
          endSec: 70,
          summary: 'The episode opening.',
        },
        {
          title: 'Listening',
          startSec: 60,
          endSec: 120,
          summary: 'How to listen well.',
        },
        {
          title: 'Practice',
          startSec: 150,
          endSec: 210,
          summary: 'A practical exercise.',
        },
      ],
      240,
    );

    expect(reconciled).toEqual([
      expect.objectContaining({
        title: 'Introduction',
        startSec: 0,
        endSec: 65,
      }),
      expect.objectContaining({
        title: 'Listening',
        startSec: 65,
        endSec: 135,
      }),
      expect.objectContaining({
        title: 'Practice',
        startSec: 135,
        endSec: 240,
      }),
    ]);
    expect(reconciled[0].startSec).toBe(0);
    expect(reconciled.at(-1)?.endSec).toBe(240);
    expect(
      reconciled
        .slice(1)
        .every((topic, index) =>
          Object.is(topic.startSec, reconciled[index].endSec),
        ),
    ).toBe(true);
  });

  it('merges duplicate topics returned in adjacent overlapping windows', () => {
    const reconciled = service.reconcile(
      [
        {
          title: 'Trust',
          startSec: 20,
          endSec: 80,
          summary: 'Listening builds trust.',
        },
        {
          title: 'Trust',
          startSec: 60,
          endSec: 100,
          summary: 'Listening builds trust.',
        },
        {
          title: 'Boundaries',
          startSec: 100,
          endSec: 160,
          summary: 'How to say no.',
        },
      ],
      180,
    );

    expect(reconciled).toHaveLength(2);
    expect(reconciled[0]).toMatchObject({
      title: 'Trust',
      startSec: 0,
      endSec: 95,
    });
    expect(reconciled[1]).toMatchObject({
      title: 'Boundaries',
      startSec: 95,
      endSec: 180,
    });
  });

  it('rejects invalid ranges before reconciliation', () => {
    expect(() => service.reconcile([], 0)).toThrow(/duration/);
    expect(() =>
      service.reconcile(
        [{ title: '', startSec: 0, endSec: 10, summary: 'Missing title.' }],
        60,
      ),
    ).toThrow(/Invalid/);
    expect(() =>
      service.reconcile(
        [
          { title: 'One', startSec: 0, endSec: 20, summary: 'First.' },
          { title: 'Two', startSec: 1, endSec: 2, summary: 'Second.' },
        ],
        60,
      ),
    ).toThrow(/increasing/);
  });
});
