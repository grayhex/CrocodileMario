import { actionBit, maskOf, type ActionMask } from '../core/actions';
import type { Phase } from '../core';
import type { InputHub } from './hub';

/** Кнопки на корпусе игрушки (подписи — как на устройстве). */
export type ToyKeyId = 'onoff' | 'sp' | 'sound' | 'fire' | 'up' | 'down' | 'left' | 'right' | 'jump';

export const TOY_KEY_IDS: readonly ToyKeyId[] = ['onoff', 'sp', 'sound', 'fire', 'up', 'down', 'left', 'right', 'jump'];

/** Игровые действия кнопок (ON/OFF, SOUND и S./P. задаются отдельно). */
export const KEY_ACTIONS: Partial<Record<ToyKeyId, ActionMask>> = {
  fire: maskOf('fire'),
  up: maskOf('up'),
  down: maskOf('down'),
  left: maskOf('left'),
  right: maskOf('right'),
  jump: maskOf('jump'),
};

const START = actionBit('start');
const PAUSE = actionBit('pause');
/** S./P. — одна кнопка старта и паузы: подсвечивается и от start, и от pause. */
export const START_PAUSE_MASK: ActionMask = START | PAUSE;

/** Что делает нажатие S./P. в этой фазе: в игре — пауза, в остальных — старт или продолжение. */
export function startPauseAction(phase: Phase): ActionMask {
  return phase === 'playing' ? PAUSE : START;
}

/** Какие кнопки корпуса подсвечены при такой маске удерживаемых действий (клавиатура, геймпад, мышь). У игрушки с другой игрой действия кнопок свои. */
export function pressedKeys(down: ActionMask, actions: Partial<Record<ToyKeyId, ActionMask>> = KEY_ACTIONS): Set<ToyKeyId> {
  const pressed = new Set<ToyKeyId>();
  for (const [id, mask] of Object.entries(actions) as [ToyKeyId, ActionMask][]) {
    if ((down & mask) !== 0) pressed.add(id);
  }
  if ((down & START_PAUSE_MASK) !== 0) pressed.add('sp');
  return pressed;
}

export interface ToyHooks {
  phase(): Phase;
  /** Включена ли игрушка: выключенная кнопки игры не слушает. */
  powered(): boolean;
  onPower(): void;
  onSound(): void;
  /** Действия кнопок вместо стандартных (`KEY_ACTIONS`): у игрушек с тетрисом FIRE, например, не стреляет. */
  keyActions?: Partial<Record<ToyKeyId, ActionMask>>;
  /** Нажатие кнопки без игрового действия, но со своим делом (RESET, TIME/GAME): `true` — обработано, действие не отправляется. */
  onPress?(id: ToyKeyId): boolean;
  /** RESET из пульта (дубль кнопки корпуса): в игрушках, где корпус выходит в меню, — возврат в меню. */
  onReset?(): void;
}

/** Идентификатор «указателя» для нажатия кнопки с клавиатуры и его длительность: хватает одного такта игры. */
const KEYBOARD_POINTER = -7;
const KEYBOARD_PRESS_MS = 90;

/**
 * Кнопки корпуса: нажимаются мышью и пальцем (игровые — через общий слой ввода, как клавиши),
 * а подсвечиваются по любому источнику — клавиатура, геймпад, мышь. Кнопки не берут фокус,
 * чтобы клавиатура осталась у игры.
 */
export class ToyPanel {
  /** Кнопки корпуса и их дубли в пульте (`bindRemote`): подсвечиваются вместе, чтобы при виде «только экран» было видно нажатие с клавиатуры и геймпада. */
  private readonly buttons = new Map<ToyKeyId, HTMLElement[]>();
  private readonly lit = new Set<ToyKeyId>();
  /** Подсветка от указателей и горячих клавиш (ON/OFF, SOUND). */
  private readonly extra = new Map<ToyKeyId, number>();
  private readonly hub: InputHub;
  private readonly hooks: ToyHooks;

  constructor(root: HTMLElement, hub: InputHub, hooks: ToyHooks) {
    this.hub = hub;
    this.hooks = hooks;
    for (const id of TOY_KEY_IDS) {
      const button = root.querySelector<HTMLElement>(`[data-key="${id}"]`);
      if (!button) continue;
      this.buttons.set(id, [button]);
      this.bind(id, button);
    }
  }

  /**
   * Дубли кнопок корпуса в пульте справа (`data-remote`: onoff, sp, reset), когда видна только крышка с экраном: мышью включить игру и запустить её иначе нельзя.
   * Работают так же, как кнопки на корпусе; с клавиатуры (`click` без указателя) нажимаются так же, как мышью, но коротко.
   */
  bindRemote(root: HTMLElement): void {
    for (const button of root.querySelectorAll<HTMLElement>('[data-remote]')) {
      const id = button.dataset['remote'];
      if (id === 'reset') {
        button.addEventListener('click', () => this.hooks.onReset?.());
      } else if (id === 'onoff' || id === 'sp') {
        this.bind(id, button);
        this.buttons.set(id, [...(this.buttons.get(id) ?? []), button]);
        if (this.lit.has(id)) button.dataset['pressed'] = '';
        button.addEventListener('click', (event) => {
          if (event.detail !== 0) return; // мышь и палец уже отработали в pointerdown
          if (id === 'onoff') this.hooks.onPower();
          else if (this.hooks.powered()) {
            this.hub.screen.press(KEYBOARD_POINTER, startPauseAction(this.hooks.phase()));
            window.setTimeout(() => this.hub.screen.release(KEYBOARD_POINTER), KEYBOARD_PRESS_MS);
          }
        });
      }
    }
  }

  /** Подсветить нажатые кнопки по маске удерживаемых действий трекера. */
  sync(down: ActionMask): void {
    const wanted = pressedKeys(down, this.hooks.keyActions);
    for (const id of this.extra.keys()) wanted.add(id);
    for (const [id, buttons] of this.buttons) {
      const on = wanted.has(id);
      if (on === this.lit.has(id)) continue;
      if (on) this.lit.add(id);
      else this.lit.delete(id);
      for (const button of buttons) {
        if (on) button.dataset['pressed'] = '';
        else delete button.dataset['pressed'];
      }
    }
  }

  /** Горячая клавиша (O, M): подсветить и выполнить действие кнопки. */
  hotkey(id: 'onoff' | 'sound', pressed: boolean): void {
    if (pressed) {
      this.extra.set(id, -1);
      this.trigger(id);
    } else {
      this.extra.delete(id);
    }
    this.sync(this.hub.tracker.down);
  }

  private trigger(id: ToyKeyId): void {
    if (id === 'onoff') this.hooks.onPower();
    else if (id === 'sound') this.hooks.onSound();
  }

  private bind(id: ToyKeyId, button: HTMLElement): void {
    button.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault(); // не забирать фокус у игры и не выделять текст
      button.setPointerCapture(event.pointerId);
      this.extra.set(id, event.pointerId);
      if (id === 'onoff' || id === 'sound') {
        this.trigger(id);
      } else if (this.hooks.onPress?.(id) !== true && this.hooks.powered()) {
        const mask = id === 'sp' ? startPauseAction(this.hooks.phase()) : ((this.hooks.keyActions ?? KEY_ACTIONS)[id] ?? 0);
        if (mask !== 0) this.hub.screen.press(event.pointerId, mask);
      }
      this.sync(this.hub.tracker.down);
    });
    const release = (event: PointerEvent): void => {
      this.hub.screen.release(event.pointerId);
      if (this.extra.get(id) === event.pointerId) this.extra.delete(id);
      this.sync(this.hub.tracker.down);
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }
}
