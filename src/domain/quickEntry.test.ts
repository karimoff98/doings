import { describe, expect, it } from 'vitest';
import { parseQuickEntry } from './quickEntry';

const monday = new Date(2026, 6, 27, 12);

describe('умный быстрый ввод', () => {
  it.each([
    ['Позвонить сегодня', 'Позвонить', { kind: 'today' }],
    ['Купить билеты завтра', 'Купить билеты', { kind: 'scheduled', date: '2026-07-28' }],
    ['Подготовить вещи послезавтра', 'Подготовить вещи', { kind: 'scheduled', date: '2026-07-29' }],
    ['Встреча в пятницу', 'Встреча', { kind: 'scheduled', date: '2026-07-31' }],
    ['Планёрка во вторник', 'Планёрка', { kind: 'scheduled', date: '2026-07-28' }],
  ])('распознаёт дату в «%s»', (input, title, when) => {
    expect(parseQuickEntry(input, monday)).toMatchObject({ title, when });
  });

  it('берёт следующий такой день недели, а не сегодняшний', () => {
    expect(parseQuickEntry('Повторить в понедельник', monday).when).toEqual({
      kind: 'scheduled',
      date: '2026-08-03',
    });
  });

  it('создаёт напоминание и убирает время из названия', () => {
    expect(parseQuickEntry('Встреча завтра в 18:30', monday)).toEqual({
      title: 'Встреча',
      when: { kind: 'scheduled', date: '2026-07-28' },
      reminder: '18:30',
      deadline: undefined,
    });
  });

  it('понимает целый час и считает время без даты сегодняшним', () => {
    expect(parseQuickEntry('Позвонить в 9', monday)).toMatchObject({
      title: 'Позвонить',
      when: { kind: 'today' },
      reminder: '09:00',
    });
  });

  it('отличает срок сдачи от даты начала', () => {
    expect(parseQuickEntry('Оплатить до пятницы', monday)).toEqual({
      title: 'Оплатить',
      when: { kind: 'unscheduled' },
      deadline: '2026-07-31',
      reminder: undefined,
    });
  });

  it('понимает относительную дату через несколько дней', () => {
    expect(parseQuickEntry('Купить билеты через 3 дня', monday)).toMatchObject({
      title: 'Купить билеты',
      when: { kind: 'scheduled', date: '2026-07-30' },
    });
  });

  it('создаёт еженедельный повтор на названный день', () => {
    expect(parseQuickEntry('Тренировка каждый понедельник в 19:00', monday)).toEqual({
      title: 'Тренировка',
      when: { kind: 'scheduled', date: '2026-08-03' },
      deadline: undefined,
      reminder: '19:00',
      repeat: { unit: 'week', every: 1, weekdays: [1] },
    });
  });

  it('правильно кодирует воскресенье как седьмой ISO-день', () => {
    expect(parseQuickEntry('Позвонить каждое воскресенье', monday)).toMatchObject({
      repeat: { unit: 'week', every: 1, weekdays: [7] },
    });
  });

  it('не вырезает похожие слова из обычного названия', () => {
    expect(parseQuickEntry('Обсудить завтрашний релиз', monday)).toEqual({
      title: 'Обсудить завтрашний релиз',
      when: { kind: 'unscheduled' },
      deadline: undefined,
      reminder: undefined,
    });
    expect(parseQuickEntry('Чёрная пятница', monday).title).toBe('Чёрная пятница');
  });

  it('не оставляет лишние пробелы и запятые', () => {
    expect(parseQuickEntry('Позвонить, завтра в 08:05', monday).title).toBe('Позвонить');
  });

  it('не создаёт задачу без названия из одной служебной фразы', () => {
    expect(parseQuickEntry('завтра', monday).title).toBe('завтра');
  });
});
