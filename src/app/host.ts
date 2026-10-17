import { preloadRoom, startApp } from './app';
import type { AppHandle, Carry } from './lifecycle';
import { startTetrisApp } from './tetrisApp';
import { mountToySwitch } from './toySwitch';
import { engineOf, parseToy, TOYS, toyHref, type ToyId } from './toys';

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`В index.html нет элемента #${id}`);
  return element;
}

/** Картинки (наклейки), которые понадобятся другим игрушкам: подгружаются заранее, чтобы при переключении ничего не «выскакивало». */
function preloadImages(): void {
  for (const id of ['clock99', 'seabattle', 'tank168'] as const) {
    const image = new Image();
    image.src = `${import.meta.env.BASE_URL}brand/sticker-${id}.webp`;
  }
}

/**
 * Хозяин страницы: держит шапку, угловое меню, диалоги и каркас игрушки (крышка, шарнир, нижняя половина), а игрушки — «приложения» — запускает
 * на нём по очереди. Переключение на месте, без перезагрузки: прежнее приложение снимается одним `dispose()`, из каркаса восстанавливаются только
 * те части, что у игрушек разные (лицевая панель крышки с экраном и нижняя половина с кнопками и наклейкой), и запускается новое — с тем же видом
 * (свёрнута / полная / только экран), цветом корпуса (если он есть у новой игрушки) и питанием. Шапка, панели, угол и положение игрушки не перерисовываются.
 */
export async function startHost(initial: ToyId): Promise<void> {
  const nav = byId('toy-switch');
  const base = byId('base');
  const face = document.querySelector<HTMLElement>('.lid__face');
  const stage = byId('stage');
  const cover = byId('lid-cover');
  const lidShell = document.querySelector('.lid__shell')!;
  if (!face) throw new Error('В index.html нет лицевой панели крышки');

  // Чистый снимок каркаса — Crocodile Mario, как он лежит в index.html: с него начинается любая игрушка.
  const pristine = {
    cover: [...cover.childNodes].map((node) => node.cloneNode(true)),
    lidShell: lidShell.cloneNode(true),
    base: [...base.childNodes].map((node) => node.cloneNode(true)),
    face: [...face.childNodes].map((node) => node.cloneNode(true)),
    stageLabel: stage.dataset['i18nAttrs'] ?? '',
  };
  const restoreShell = (): void => {
    cover.replaceChildren(...pristine.cover.map((node) => node.cloneNode(true)));
    document.querySelector('.lid__shell')?.replaceWith(pristine.lidShell.cloneNode(true));
    base.replaceChildren(...pristine.base.map((node) => node.cloneNode(true)));
    face.replaceChildren(...pristine.face.map((node) => node.cloneNode(true)));
    stage.dataset['i18nAttrs'] = pristine.stageLabel;
    for (const element of [byId('toy'), byId('arena')]) {
      delete element.dataset['model'];
      delete element.dataset['deco'];
    }
    delete document.body.dataset['toy'];
    document.title = TOYS.mario.name;
  };

  /** Заголовок страницы — название открытой игрушки (а не всегда «Crocodile Mario»): так его читают скринридеры и индексаторы. */
  const heading = document.querySelector('h1');
  const mount = (id: ToyId, carry?: Carry): Promise<AppHandle> => {
    if (heading) heading.textContent = TOYS[id].name;
    if (id === 'alibaba' || id === 'minibrick') return import('./exhibitApp').then(({startExhibitApp}) => startExhibitApp(id, carry));
    return engineOf(TOYS[id]) === 'tetris' ? startTetrisApp(id, carry) : startApp('room', carry);
  };

  const toySwitch = mountToySwitch(nav, initial, (id) => void switchTo(id, true));
  let current: { id: ToyId; handle: AppHandle } = { id: initial, handle: await mount(initial) };
  // Цвет, который выбрал игрок: если у очередной игрушки его нет (она открывается другим), выбор не теряется — следующая, где он есть, снова его получит.
  let shown = current.handle.carry().shell;
  let preferred = shown;
  // Пока играют, остальное подгружается в фоне.
  preloadImages();
  preloadRoom();

  let busy = false;
  let queued: { id: ToyId; push: boolean } | null = null;

  /** Подготовка новой игрушки до того, как прежняя будет снята: данные и картинки уже на месте, поэтому замена пройдёт за один кадр. */
  async function prepare(id: ToyId): Promise<void> {
    if (engineOf(TOYS[id]) === 'exhibit') await import('./exhibitApp');
    if (engineOf(TOYS[id]) === 'mario') {
      await preloadRoom();
    } else {
      const image = new Image();
      image.src = `${import.meta.env.BASE_URL}brand/${id === 'brickgame' ? 'brick-game-wordmark.svg' : engineOf(TOYS[id]) === 'exhibit' ? `${id}-logos.png` : `sticker-${id}.webp`}`;
      await image.decode().catch(() => undefined); // не загрузилась — игрушка всё равно запустится, наклейка появится позже
    }
  }

  async function switchTo(next: ToyId, push: boolean): Promise<void> {
    if (busy) {
      queued = { id: next, push };
      return;
    }
    if (next === current.id) return;
    busy = true;
    try {
      await prepare(next);
      const carry = current.handle.carry();
      if (carry.shell !== shown) preferred = carry.shell; // цвет сменил игрок на самой странице
      current.handle.dispose();
      restoreShell();
      if (push) window.history.pushState({ toy: next }, '', toyHref(next, window.location.search));
      toySwitch.setCurrent(next);
      current = { id: next, handle: await mount(next, { ...carry, shell: preferred }) };
      shown = current.handle.carry().shell;
    } catch (error) {
      const box = document.getElementById('fatal');
      const text = document.getElementById('fatal-text');
      if (box && text) {
        box.hidden = false;
        text.textContent = error instanceof Error ? error.message : String(error);
      }
      console.error(error);
    } finally {
      busy = false;
      const waiting = queued;
      queued = null;
      if (waiting) void switchTo(waiting.id, waiting.push);
    }
  }

  // «Назад» и «вперёд» браузера возвращают к прежней игрушке — тоже на месте.
  window.addEventListener('popstate', () => void switchTo(parseToy(window.location.search), false));
}
