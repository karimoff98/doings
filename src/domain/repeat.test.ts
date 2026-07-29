import { describe, expect, it } from 'vitest';
import { shiftDay, today } from './dates';
import { describeRepeat, nextOccurrence, nextRepeatCopy } from './repeat';
import type { Todo } from './types';

let counter = 0;
const makeId = (prefix: string) => `${prefix}_new${(counter += 1)}`;

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 'td_1',
    title: 'Полить цветы',
    notes: '',
    checklist: [],
    when: { kind: 'scheduled', date: '2026-03-10' },
    tagIds: [],
    status: 'open',
    trashed: false,
    createdAt: '2026-03-01T10:00:00.000Z',
    index: 5,
    ...overrides,
  };
}

describe('nextOccurrence', () => {
  it('шагает по дням с учётом интервала', () => {
    expect(nextOccurrence({ unit: 'day', every: 1 }, '2026-03-10')).toBe('2026-03-11');
    expect(nextOccurrence({ unit: 'day', every: 4 }, '2026-03-30')).toBe('2026-04-03');
  });

  it('шагает по неделям, месяцам и годам', () => {
    expect(nextOccurrence({ unit: 'week', every: 2 }, '2026-03-10')).toBe('2026-03-24');
    expect(nextOccurrence({ unit: 'month', every: 1 }, '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence({ unit: 'year', every: 1 }, '2026-03-10')).toBe('2027-03-10');
  });

  it('для правила по будням берёт следующий рабочий день', () => {
    const weekdays = { unit: 'week' as const, every: 1, weekdays: [1, 2, 3, 4, 5] };
    // 2026-03-13 — пятница, дальше должен быть понедельник.
    expect(nextOccurrence(weekdays, '2026-03-13')).toBe('2026-03-16');
    expect(nextOccurrence(weekdays, '2026-03-16')).toBe('2026-03-17');
  });

  it('после последнего дня пропускает неактивные недели интервала', () => {
    const everyTwoWeeks = { unit: 'week' as const, every: 2, weekdays: [1, 3] };
    // Среда 11 марта -> понедельник через одну пропущенную неделю.
    expect(nextOccurrence(everyTwoWeeks, '2026-03-11')).toBe('2026-03-23');
    // Внутри активной недели понедельник всё ещё переходит на среду.
    expect(nextOccurrence(everyTwoWeeks, '2026-03-09')).toBe('2026-03-11');
  });

  it('не зацикливается на интервале меньше единицы', () => {
    expect(nextOccurrence({ unit: 'day', every: 0 }, '2026-03-10')).toBe('2026-03-11');
  });
});

describe('describeRepeat', () => {
  it('согласует род и число', () => {
    expect(describeRepeat({ unit: 'day', every: 1 })).toBe('каждый день');
    expect(describeRepeat({ unit: 'week', every: 1 })).toBe('каждую неделю');
    expect(describeRepeat({ unit: 'week', every: 2 })).toBe('каждые 2 недели');
    expect(describeRepeat({ unit: 'month', every: 6 })).toBe('каждые 6 месяцев');
  });

  it('перечисляет дни недели', () => {
    expect(describeRepeat({ unit: 'week', every: 1, weekdays: [1, 3] })).toBe(
      'каждую неделю: пн, ср',
    );
  });
});

describe('nextRepeatCopy', () => {
  it('без правила повтора копии нет', () => {
    expect(nextRepeatCopy(todo(), makeId)).toBeUndefined();
  });

  it('переносит содержимое, обнуляет чеклист и сдвигает срок сдачи', () => {
    const source = todo({
      repeat: { unit: 'day', every: 1 },
      deadline: '2026-03-12',
      checklist: [
        { id: 'ci_a', title: 'Взять лейку', done: true },
        { id: 'ci_b', title: 'Открыть окно', done: false },
      ],
      projectId: 'prj_1',
      headingId: 'hd_1',
      tagIds: ['tag_1'],
      reminder: '09:00',
    });

    const copy = nextRepeatCopy(source, makeId);

    expect(copy?.when).toEqual({ kind: 'scheduled', date: '2026-03-11' });
    // Срок сдачи сдвигается на столько же дней, сколько и дата начала.
    expect(copy?.deadline).toBe('2026-03-13');
    expect(copy?.checklist.map((item) => item.done)).toEqual([false, false]);
    expect(copy?.checklist.map((item) => item.title)).toEqual(['Взять лейку', 'Открыть окно']);
    expect(copy?.checklist.map((item) => item.id)).not.toEqual(['ci_a', 'ci_b']);
    expect(copy?.projectId).toBe('prj_1');
    expect(copy?.headingId).toBe('hd_1');
    expect(copy?.tagIds).toEqual(['tag_1']);
    expect(copy?.reminder).toBe('09:00');
    expect(copy?.status).toBe('open');
    expect(copy?.id).not.toBe(source.id);
    expect(Date.parse(copy!.createdAt)).toBeGreaterThan(Date.parse(source.createdAt));
  });

  it('связывает всю серию с первой задачей', () => {
    const first = todo({ id: 'td_first', repeat: { unit: 'day', every: 1 } });
    const second = nextRepeatCopy(first, makeId);
    const third = nextRepeatCopy({ ...second!, when: first.when }, makeId);

    expect(second?.seriesId).toBe('td_first');
    expect(third?.seriesId).toBe('td_first');
  });

  it('вечерняя задача остаётся вечерней, если следующий день — сегодня', () => {
    const evening = todo({ when: { kind: 'evening' }, repeat: { unit: 'day', every: 1 } });
    // База — сегодня, значит следующий день — завтра, и это уже не «вечером сегодня».
    expect(nextRepeatCopy(evening, makeId)?.when).toEqual({
      kind: 'scheduled',
      date: shiftDay(today(), 1),
    });
  });
});
