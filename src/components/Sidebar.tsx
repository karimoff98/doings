import { useMemo, useState } from 'react';
import type { DragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { SMART_LIST_META, listCount, projectProgress, projectTitle } from '../domain/lists';
import type { Area, ListKey, Project, SmartList } from '../domain/types';
import { useStore } from '../store/store';
import { ProgressRing } from './Checkbox';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Menu } from './Menu';
import type { MenuItem, MenuPosition } from './Menu';
import { SaveIndicator } from './SaveIndicator';

const GROUPS: SmartList[][] = [
  ['inbox'],
  ['today', 'upcoming', 'anytime', 'someday'],
  ['logbook', 'trash'],
];

/** What is being dragged inside the sidebar itself: a project or an area row. */
interface SidebarDragItem {
  kind: 'project' | 'area';
  id: string;
}

interface SidebarDrop {
  active?: ListKey;
  /** Props to spread on a sidebar row that can receive todos. */
  bind: (key: ListKey) => {
    onDragOver: (event: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (event: DragEvent) => void;
  };
}

/**
 * Dropping todos on the sidebar does what Things does: a project or area
 * re-homes them, a smart list re-schedules, the trash throws them away.
 */
function useSidebarDrop(): SidebarDrop {
  const draggingIds = useStore((s) => s.draggingIds);
  const moveTodo = useStore((s) => s.moveTodo);
  const setWhen = useStore((s) => s.setWhen);
  const completeTodo = useStore((s) => s.completeTodo);
  const trashTodo = useStore((s) => s.trashTodo);
  const endDrag = useStore((s) => s.endDrag);
  const [active, setActive] = useState<ListKey | undefined>(undefined);

  const accepts = (key: ListKey) => key !== 'upcoming';

  const apply = (key: ListKey, ids: string[]) => {
    if (key.startsWith('project:')) {
      moveTodo(ids, { projectId: key.slice('project:'.length) });
      return;
    }
    if (key.startsWith('area:')) {
      moveTodo(ids, { areaId: key.slice('area:'.length) });
      return;
    }
    switch (key) {
      case 'inbox':
        moveTodo(ids, {});
        return;
      case 'today':
        setWhen(ids, { kind: 'today' });
        return;
      case 'anytime':
        setWhen(ids, { kind: 'unscheduled' });
        return;
      case 'someday':
        setWhen(ids, { kind: 'someday' });
        return;
      case 'logbook':
        completeTodo(ids);
        return;
      case 'trash':
        trashTodo(ids);
        return;
      default:
        return;
    }
  };

  return {
    active,
    bind: (key) => ({
      onDragOver: (event) => {
        if (!draggingIds.length || !accepts(key)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (active !== key) setActive(key);
      },
      onDragLeave: () => setActive((current) => (current === key ? undefined : current)),
      onDrop: (event) => {
        if (!draggingIds.length || !accepts(key)) return;
        event.preventDefault();
        event.stopPropagation();
        apply(key, draggingIds);
        setActive(undefined);
        endDrag();
      },
    }),
  };
}

export function Sidebar() {
  const db = useStore((s) => s.db);
  const selectedList = useStore((s) => s.selectedList);
  const selectList = useStore((s) => s.selectList);
  const dropTarget = useSidebarDrop();
  const createProject = useStore((s) => s.createProject);
  const createArea = useStore((s) => s.createArea);
  const updateArea = useStore((s) => s.updateArea);

  const setShortcuts = useStore((s) => s.setShortcuts);
  const setSettings = useStore((s) => s.setSettings);
  const createTodo = useStore((s) => s.createTodo);
  const completeProject = useStore((s) => s.completeProject);
  const trashProject = useStore((s) => s.trashProject);
  const trashArea = useStore((s) => s.trashArea);
  const emptyTrash = useStore((s) => s.emptyTrash);
  const focusListTitle = useStore((s) => s.focusListTitle);
  const reorderProjects = useStore((s) => s.reorderProjects);
  const reorderAreas = useStore((s) => s.reorderAreas);
  const moveProject = useStore((s) => s.moveProject);
  const [menu, setMenu] = useState<{
    at: MenuPosition;
    groups: MenuItem[][];
    title: string;
  } | null>(null);
  const [dragItem, setDragItem] = useState<SidebarDragItem | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  /** Opens a context menu for a sidebar row at the pointer. */
  const openMenu = (event: ReactMouseEvent, title: string, groups: MenuItem[][]) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ at: { x: event.clientX, y: event.clientY }, groups, title });
  };

  const projectMenu = (project: Project): MenuItem[][] => [
    [
      {
        key: 'open',
        label: 'Открыть',
        icon: 'project',
        color: 'var(--c-project)',
        run: () => selectList(`project:${project.id}`),
      },
      {
        key: 'new-todo',
        label: 'Новая задача',
        icon: 'plus',
        run: () => {
          selectList(`project:${project.id}`);
          createTodo();
        },
      },
      {
        key: 'rename',
        label: 'Переименовать',
        icon: 'notes',
        run: () => {
          selectList(`project:${project.id}`);
          focusListTitle(project.id);
        },
      },
    ],
    [
      {
        key: 'complete',
        label: project.status === 'open' ? 'Завершить проект' : 'Возобновить проект',
        icon: 'check',
        run: () => completeProject(project.id),
      },
      {
        key: 'trash',
        label: 'Удалить проект',
        icon: 'trash',
        color: 'var(--c-deadline)',
        run: () => {
          const label = project.title || 'проект';
          if (!window.confirm(`Удалить «${label}» вместе с задачами? Проект окажется в корзине.`)) {
            return;
          }
          trashProject(project.id);
          if (selectedList === `project:${project.id}`) selectList('today');
        },
      },
    ],
  ];

  const areaMenu = (area: Area): MenuItem[][] => [
    [
      {
        key: 'open',
        label: 'Открыть',
        icon: 'area',
        run: () => selectList(`area:${area.id}`),
      },
      {
        key: 'new-project',
        label: 'Новый проект здесь',
        icon: 'plus',
        run: () => selectList(`project:${createProject({ areaId: area.id })}`),
      },
      {
        key: 'rename',
        label: 'Переименовать',
        icon: 'notes',
        run: () => {
          selectList(`area:${area.id}`);
          focusListTitle(area.id);
        },
      },
    ],
    [
      {
        key: 'trash',
        label: 'Удалить область',
        icon: 'trash',
        color: 'var(--c-deadline)',
        run: () => {
          const label = area.title || 'область';
          if (
            !window.confirm(
              `Удалить «${label}»? Её задачи уйдут во Входящие, проекты станут самостоятельными.`,
            )
          ) {
            return;
          }
          trashArea(area.id);
          if (selectedList === `area:${area.id}`) selectList('today');
        },
      },
    ],
  ];

  const smartMenu = (key: SmartList): MenuItem[][] => {
    const canAdd = key !== 'logbook' && key !== 'trash' && key !== 'upcoming';
    return [
      [
        { key: 'open', label: 'Открыть', icon: 'chevron-right', run: () => selectList(key) },
        ...(canAdd
          ? [
              {
                key: 'new-todo',
                label: 'Новая задача',
                icon: 'plus' as IconName,
                hint: '⌘N',
                run: () => {
                  selectList(key);
                  createTodo();
                },
              },
            ]
          : []),
      ],
      key === 'trash'
        ? [
            {
              key: 'empty',
              label: 'Очистить корзину',
              icon: 'trash',
              color: 'var(--c-deadline)',
              run: () => {
                if (window.confirm('Удалить содержимое корзины навсегда?')) emptyTrash();
              },
            },
          ]
        : [],
    ];
  };

  // Project and area order changes rarely; editing a todo's notes should not
  // make the sidebar re-sort everything it shows.
  const activeProjects = useMemo(
    () =>
      db.projects
        .filter((p) => p.status === 'open' && !p.trashed)
        .sort((a, b) => a.index - b.index),
    [db.projects],
  );
  const looseProjects = useMemo(() => activeProjects.filter((p) => !p.areaId), [activeProjects]);
  const areas = useMemo(() => [...db.areas].sort((a, b) => a.index - b.index), [db.areas]);

  /** Places the dragged project next to `target`, moving it between areas if needed. */
  const dropProjectNear = (id: string, target: Project, after: boolean) => {
    const dragged = activeProjects.find((project) => project.id === id);
    if (!dragged) return;
    if (dragged.areaId !== target.areaId) moveProject(id, target.areaId);
    const group = activeProjects
      .filter((project) => project.areaId === target.areaId && project.id !== id)
      .map((project) => project.id);
    const at = group.indexOf(target.id);
    if (at === -1) return;
    const cut = after ? at + 1 : at;
    reorderProjects([...group.slice(0, cut), id, ...group.slice(cut)]);
  };

  /** Drag handlers for a project row: reordering plus the existing todo drops. */
  const projectDragProps = (project: Project) => {
    const key: ListKey = `project:${project.id}`;
    const base = dropTarget.bind(key);
    const accepts = dragItem?.kind === 'project' && dragItem.id !== project.id;
    return {
      draggable: true,
      onDragStart: (event: DragEvent) => {
        setDragItem({ kind: 'project', id: project.id });
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', project.id);
      },
      onDragEnd: () => {
        setDragItem(null);
        setDragOver(null);
      },
      onDragOver: (event: DragEvent) => {
        base.onDragOver(event);
        if (!accepts) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (dragOver !== key) setDragOver(key);
      },
      onDragLeave: () => {
        base.onDragLeave();
        setDragOver((current) => (current === key ? null : current));
      },
      onDrop: (event: DragEvent) => {
        base.onDrop(event);
        if (!accepts || !dragItem) return;
        event.preventDefault();
        event.stopPropagation();
        const box = event.currentTarget.getBoundingClientRect();
        dropProjectNear(dragItem.id, project, event.clientY - box.top > box.height / 2);
        setDragItem(null);
        setDragOver(null);
      },
    };
  };

  /** Drag handlers for an area row: takes projects in, and reorders areas. */
  const areaDragProps = (area: Area) => {
    const key: ListKey = `area:${area.id}`;
    const base = dropTarget.bind(key);
    const accepts =
      dragItem?.kind === 'project' || (dragItem?.kind === 'area' && dragItem.id !== area.id);
    return {
      draggable: true,
      onDragStart: (event: DragEvent) => {
        setDragItem({ kind: 'area', id: area.id });
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', area.id);
      },
      onDragEnd: () => {
        setDragItem(null);
        setDragOver(null);
      },
      onDragOver: (event: DragEvent) => {
        base.onDragOver(event);
        if (!accepts) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (dragOver !== key) setDragOver(key);
      },
      onDragLeave: () => {
        base.onDragLeave();
        setDragOver((current) => (current === key ? null : current));
      },
      onDrop: (event: DragEvent) => {
        base.onDrop(event);
        if (!accepts || !dragItem) return;
        event.preventDefault();
        event.stopPropagation();

        if (dragItem.kind === 'project') {
          // Dropping on the area header puts the project at the end of it.
          moveProject(dragItem.id, area.id);
          const group = activeProjects
            .filter((project) => project.areaId === area.id && project.id !== dragItem.id)
            .map((project) => project.id);
          reorderProjects([...group, dragItem.id]);
        } else {
          const box = event.currentTarget.getBoundingClientRect();
          const after = event.clientY - box.top > box.height / 2;
          const group = areas.filter((item) => item.id !== dragItem.id).map((item) => item.id);
          const at = group.indexOf(area.id);
          const cut = after ? at + 1 : at;
          reorderAreas([...group.slice(0, cut), dragItem.id, ...group.slice(cut)]);
        }

        setDragItem(null);
        setDragOver(null);
      },
    };
  };

  const renderProject = (project: Project, nested: boolean) => (
    <button
      key={project.id}
      type="button"
      className={[
        'srow',
        'srow--project',
        nested && 'srow--nested',
        selectedList === `project:${project.id}` && 'srow--active',
        (dropTarget.active === `project:${project.id}` || dragOver === `project:${project.id}`) &&
          'srow--drop',
        dragItem?.kind === 'project' && dragItem.id === project.id && 'srow--dragging',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => selectList(`project:${project.id}`)}
      onContextMenu={(event) => openMenu(event, projectTitle(project), projectMenu(project))}
      {...projectDragProps(project)}
    >
      <span className="srow__icon">
        <ProgressRing progress={projectProgress(db, project.id)} />
      </span>
      <span className="srow__title">{projectTitle(project)}</span>
      {listCount(db, `project:${project.id}`) > 0 && (
        <span className="srow__count">{listCount(db, `project:${project.id}`)}</span>
      )}
    </button>
  );

  const renderSmart = (key: SmartList) => {
    const meta = SMART_LIST_META[key];
    const count = listCount(db, key);
    return (
      <button
        key={key}
        type="button"
        className={[
          'srow',
          selectedList === key && 'srow--active',
          dropTarget.active === key && 'srow--drop',
        ]
          .filter(Boolean)
          .join(' ')}
        data-testid={`sidebar-${key}`}
        onClick={() => selectList(key)}
        onContextMenu={(event) => openMenu(event, meta.title, smartMenu(key))}
        {...dropTarget.bind(key)}
      >
        <span className="srow__icon">
          <Icon name={meta.icon as IconName} size={16} color={meta.accent} />
        </span>
        <span className="srow__title">{meta.title}</span>
        {count > 0 && <span className="srow__count">{count}</span>}
      </button>
    );
  };

  return (
    <nav className="sidebar" aria-label="Списки">
      {menu && (
        <Menu at={menu.at} groups={menu.groups} title={menu.title} onClose={() => setMenu(null)} />
      )}

      <div className="sidebar__titlebar">
        <span className="sidebar__dots" aria-hidden="true">
          <span className="sidebar__dot" />
          <span className="sidebar__dot" />
          <span className="sidebar__dot" />
        </span>
      </div>

      <div className="sidebar__scroll">
        {GROUPS.map((group, index) => (
          <div key={index} className="sidebar__group">
            {group.map(renderSmart)}
          </div>
        ))}

        <div className="sidebar__group">
          {looseProjects.map((project) => renderProject(project, false))}

          {areas.map((area) => {
            const areaKey: ListKey = `area:${area.id}`;
            const projects = activeProjects.filter((p) => p.areaId === area.id);
            return (
              <div key={area.id}>
                <div
                  className={[
                    'srow',
                    'srow--area',
                    selectedList === areaKey && 'srow--active',
                    (dropTarget.active === areaKey || dragOver === areaKey) && 'srow--drop',
                    dragItem?.kind === 'area' && dragItem.id === area.id && 'srow--dragging',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onContextMenu={(event) =>
                    openMenu(event, area.title || 'Область', areaMenu(area))
                  }
                  {...areaDragProps(area)}
                >
                  <button
                    type="button"
                    className="srow__disclosure"
                    aria-label={area.collapsed ? 'Развернуть' : 'Свернуть'}
                    aria-expanded={!area.collapsed}
                    onClick={() => updateArea(area.id, { collapsed: !area.collapsed })}
                  >
                    <Icon
                      name="chevron-right"
                      size={11}
                      className={area.collapsed ? '' : 'srow__disclosure--open'}
                    />
                  </button>
                  <button
                    type="button"
                    className="srow__title"
                    style={{ textAlign: 'left' }}
                    onClick={() => selectList(areaKey)}
                  >
                    {area.title}
                  </button>
                </div>
                {!area.collapsed && projects.map((project) => renderProject(project, true))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sidebar__footer">
        <button
          type="button"
          className="sidebar__action"
          onClick={() => selectList(`project:${createProject()}`)}
        >
          <Icon name="plus" size={13} />
          Проект
        </button>
        <button
          type="button"
          className="sidebar__action"
          onClick={() => selectList(`area:${createArea()}`)}
        >
          <Icon name="area" size={13} />
          Область
        </button>
        <span className="sidebar__spacer" />
        <SaveIndicator />
        <button
          type="button"
          className="sidebar__action"
          aria-label="Горячие клавиши"
          title="Горячие клавиши"
          onClick={() => setShortcuts(true)}
        >
          <Icon name="keyboard" size={14} />
        </button>
        <button
          type="button"
          className="sidebar__action"
          aria-label="Настройки"
          title="Настройки (⌘,)"
          data-testid="open-settings"
          onClick={() => setSettings(true)}
        >
          <Icon name="gear" size={14} />
        </button>
      </div>
    </nav>
  );
}
