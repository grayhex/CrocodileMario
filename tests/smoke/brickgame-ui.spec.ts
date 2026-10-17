import { test, expect, type Page } from '@playwright/test';
import defaults from '../../src/config/default.json' with { type: 'json' };
import { universalGames, validateConfig } from '../../src/config/schema';

const area = (page: Page, name: string) => page.locator('#game-area').getAttribute(`data-${name}`);

test.afterEach(async ({ page }) => {
  expect((page as Page & { __errors?: string[] }).__errors ?? []).toEqual([]);
});
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  (page as Page & { __errors?: string[] }).__errors = errors;
  page.on('pageerror', (error) => errors.push(error.message));
});
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page: Page, query: string, edit?: (config: ReturnType<typeof validateConfig>) => void): Promise<void> {
  const config = validateConfig(defaults);
  edit?.(config);
  await page.route('**/api/config', (route) => route.fulfill({ json: { config, revision: 1 } }));
  await page.goto(`./${query}`);
  await expect(page.locator('#game-area')).toHaveAttribute('data-phase', 'ready');
}

test('сайт без параметра открывает универсальный Brick Game, Crocodile Mario — по ?toy=mario', async ({ page }) => {
  await open(page, '');
  await expect(page.locator('#toy')).toHaveAttribute('data-model', 'brickgame');
  await expect(page.locator('.toysw__universal')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('h1')).toHaveText('Brick Game'); // заголовок страницы следует за открытой игрушкой
  await page.locator('.toysw__item[data-toy=mario]').click();
  await expect(page.locator('h1')).toHaveText('Crocodile Mario');
  await expect(page).toHaveURL(/\?toy=mario$/);
  await expect(page.locator('.toysw__item[data-toy=mario]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#toy')).not.toHaveAttribute('data-model', 'brickgame');
  await page.locator('.toysw__universal').click();
  await expect(page.locator('#toy')).toHaveAttribute('data-model', 'brickgame');
  expect(new URL(page.url()).search).toBe('');
});

test('корпус универсального Brick Game: без верхних винтов, рамка у стекла, узоры по бокам, подписи направлений, надпись «N IN 1»', async ({ page }) => {
  await open(page, '?toy=brickgame');
  await expect(page.locator('.lid__screw--tl, .lid__screw--tr')).toHaveCount(0);
  await expect(page.locator('.lid__screw--bl, .lid__screw--br')).toHaveCount(2);
  // Узор: по восемнадцати ячеек (рамка и квадрат внутри) с каждой стороны, стороны разные.
  const sides = await page.locator('.classic__motif').evaluateAll((nodes) => nodes.map((node) => [node.querySelectorAll('rect').length, node.innerHTML]));
  expect(sides.map(([count]) => count)).toEqual([36, 36]);
  expect(sides[0]![1]).not.toBe(sides[1]![1]);
  // Желтая рамка прилегает к стеклу ровно: одинаковая толщина со всех сторон и скругление.
  const ring = await page.locator('.lid__bezel').evaluate((node) => {
    const style = getComputedStyle(node, '::after');
    return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth, style.borderTopColor];
  });
  expect(new Set(ring.slice(0, 4)).size).toBe(1);
  expect(ring[4]).toBe('rgb(239, 210, 60)');
  const captions = await page.locator('.classic__key .classic__caption').evaluateAll((nodes) => nodes.map((node) => [(node.parentElement as HTMLElement).dataset['key'], node.textContent]));
  expect(captions).toEqual([['up', 'MODE'], ['left', 'LEVEL'], ['right', 'SPEED'], ['down', 'MODE']]);
  // Надпись двумя строками под углом и число игр, назначенных приставке сейчас.
  const games = universalGames(validateConfig(defaults)).length;
  await expect(page.locator('.classic__count')).toHaveText(`${games} IN 1`);
  await expect(page.locator('.classic__brand')).toHaveText(['BRICK', 'GAME']);
  await expect(page.locator('.classic__face circle').first()).toBeAttached(); // красный знак с улыбкой и ладонями рядом с надписью
  await expect(page.locator('.classic__wordmark')).toHaveCSS('pointer-events', 'none'); // не перекрывает кнопки
});

test('число в «N IN 1» следует за настройкой: закреплённые в админке и оставшиеся без владельца игры', async ({ page }) => {
  const edited = validateConfig(defaults);
  edited.toys.clock99.games = [{ id: 'tetris' }];
  edited.toys.clock99.defaultGame = 'tetris';
  const expected = universalGames(edited).length;
  expect(expected).toBeGreaterThan(universalGames(validateConfig(defaults)).length);
  await open(page, '?toy=brickgame', (config) => {
    config.toys.clock99.games = [{ id: 'tetris' }];
    config.toys.clock99.defaultGame = 'tetris';
  });
  await expect(page.locator('.classic__count')).toHaveText(`${expected} IN 1`);
});

test('FIRE нарисована только там, где она нужна: Tetris — да, Snake — нет; в меню следует за выбранной игрой', async ({ page }) => {
  await open(page, '?toy=brickgame&power=on&debug', (config) => {
    config.toys.brickgame.games = [{ id: 'snake' }, { id: 'tetris' }, { id: 'sokoban' }];
    config.toys.brickgame.defaultGame = 'snake';
  });
  const fire = page.locator('[data-key=fire]');
  await expect.poll(() => area(page, 'boot')).toBe('off');
  await expect(page.locator('#toy')).toHaveAttribute('data-fire', 'off');
  await expect(fire).toBeHidden();
  await page.locator('[data-key=jump]').click(); // ROTATE в меню: следующая игра
  await expect.poll(() => area(page, 'game')).toBe('tetris');
  await expect(page.locator('#toy')).toHaveAttribute('data-fire', 'on');
  await expect(fire).toBeVisible();
  await page.locator('[data-key=jump]').click();
  await expect.poll(() => area(page, 'game')).toBe('sokoban');
  await expect(fire).toBeVisible();
});

test('человечек: стоит, после конца игры огорчён, после RESET снова стоит', async ({ page }) => {
  await open(page, '?toy=brickgame&power=on&debug&seed=7', (config) => {
    config.toys.brickgame.games = [{ id: 'tetris' }];
    config.toys.brickgame.defaultGame = 'tetris';
  });
  await expect.poll(() => area(page, 'boot')).toBe('off');
  await expect(page.locator('#game-area')).toHaveAttribute('data-mood', 'idle');
  await page.locator('[data-key=sp]').click();
  await expect.poll(() => area(page, 'phase')).toBe('playing');
  for (let i = 0; i < 60 && (await area(page, 'phase')) !== 'over'; i++) {
    await page.locator('[data-key=fire]').click(); // жёсткое падение, пока стакан не заполнится
    await page.waitForTimeout(40);
  }
  await expect.poll(() => area(page, 'phase')).toBe('over');
  await expect(page.locator('#game-area')).toHaveAttribute('data-mood', 'sad');
  await page.locator('[data-action=reset]').click();
  await expect(page.locator('#game-area')).toHaveAttribute('data-mood', 'idle');
});

test('пульт: в виде «только экран» есть дубль ON/OFF, START / PAUSE и RESET, в полном виде его нет', async ({ page }) => {
  await open(page, '?toy=brickgame&view=screen');
  const remote = page.locator('#blk-remote');
  await expect(remote).toBeVisible();
  await expect(remote.locator('button')).toHaveText(['ON/OFF', 'START / PAUSE', 'RESET']);
  await expect(page.locator('#game-area')).toHaveAttribute('data-power', 'off');
  await remote.locator('[data-remote=onoff]').click();
  await expect(page.locator('#game-area')).toHaveAttribute('data-power', 'on');
  await expect.poll(() => area(page, 'boot')).toBe('off');
  await remote.locator('[data-remote=sp]').click();
  await expect.poll(() => area(page, 'phase')).toBe('playing');
  await remote.locator('[data-remote=sp]').click();
  await expect.poll(() => area(page, 'phase')).toBe('paused');
  await remote.locator('[data-remote=reset]').click();
  await expect.poll(() => area(page, 'menu')).toBe('menu');
  await expect.poll(() => area(page, 'phase')).toBe('ready');
  await remote.locator('[data-remote=onoff]').click();
  await expect(page.locator('#game-area')).toHaveAttribute('data-power', 'off');
  await page.locator('#view-full').click();
  await expect(remote).toBeHidden();
});

test('пульт Mario: дубль ON/OFF и START / PAUSE (RESET у Mario нет) виден только при виде «только экран»', async ({ page }) => {
  await open(page, '?toy=mario&view=screen');
  const remote = page.locator('#blk-remote');
  await expect(remote.locator('button')).toHaveText(['ON/OFF', 'START / PAUSE']);
  await remote.locator('[data-remote=onoff]').click();
  await expect(page.locator('#game-area')).toHaveAttribute('data-power', 'on');
  await page.locator('#view-full').click();
  await expect(remote).toBeHidden();
});

test('карусель: «Alibaba Dance 99 in 1» в одну строку; цвет миниатюр берётся из настройки', async ({ page }) => {
  await open(page, '?toy=brickgame', (config) => {
    config.toys.tank168.thumbShell = 'red';
    config.toys.clock99.thumbShell = 'yellow';
  });
  const name = page.locator('.toysw__item[data-toy=alibaba] .toysw__name');
  await expect(name).toHaveText('Alibaba Dance 99 in 1');
  expect(await name.evaluate((node) => getComputedStyle(node).whiteSpace)).toBe('nowrap');
  expect(await name.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThan(18);
  await expect(page.locator('.toysw__item[data-toy=tank168]')).toHaveAttribute('data-shell', 'red');
  await expect(page.locator('.toysw__item[data-toy=clock99]')).toHaveAttribute('data-shell', 'yellow');
  await expect(page.locator('.toysw__item[data-toy=mario]')).toHaveAttribute('data-shell', 'white');
});

test('«Сегменты экрана»: на кнопке «Вкл» яркие светящиеся сегменты, на «Выкл» — тусклые', async ({ page }) => {
  await open(page, '?toy=brickgame');
  const lit = page.locator('.segments__choice:has([value=on]) .icon');
  const dim = page.locator('.segments__choice:has([value=off]) .icon');
  expect(await lit.evaluate((node) => getComputedStyle(node).filter)).toContain('drop-shadow');
  expect(Number(await dim.evaluate((node) => getComputedStyle(node).opacity))).toBeLessThan(0.5);
  await page.locator('.segments__choice:has([value=off])').click();
  expect(await lit.evaluate((node) => getComputedStyle(node).filter)).toBe('none');
});

test('пульт: дубли кнопок подсвечиваются при нажатии с клавиатуры, пока видны только экран и пульт', async ({ page }) => {
  await open(page, '?toy=brickgame&view=screen&power=on');
  await expect.poll(() => area(page, 'boot')).toBe('off');
  const start = page.locator('[data-remote=sp]');
  await expect(start).not.toHaveAttribute('data-pressed', '');
  await page.keyboard.down('Enter'); // S./P.
  await expect(start).toHaveAttribute('data-pressed', '');
  await page.keyboard.up('Enter');
  await expect(start).not.toHaveAttribute('data-pressed', '');
});
