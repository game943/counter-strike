# Counter Strike Web

A Counter-Strike–style 3D first-person shooter that runs in the browser. It's
plain HTML/CSS/JavaScript with [Three.js](https://threejs.org), so there is no
build step and nothing to install.

You play as a Counter-Terrorist on a desert map against AI terrorists. Clear
every enemy before the round timer runs out. Each round adds more enemies, and
they get faster and more accurate.

## Features

- First-person movement: run, walk, crouch, jump, and climb onto crates
- Rifle (full-auto) and pistol (semi-auto) with recoil, spread, reloads and ammo
- Hit zones: headshots kill in one hit, leg shots do less damage
- Bots that patrol, react to gunfire, chase your last known position, strafe and fire in bursts
- Round system with CT/T score, round timer, kill feed, radar, hit markers and damage flash
- Procedural textures and synthesized sound, so the repo has no asset files

## Controls

| Key | Action |
|---|---|
| W A S D / arrows | Move |
| Mouse | Aim |
| Left click | Shoot (hold for rifle auto-fire) |
| Space | Jump |
| Shift | Walk (more accurate) |
| C / Ctrl | Crouch (most accurate) |
| R | Reload |
| 1 / 2, Q, mouse wheel | Switch rifle / pistol |
| Esc | Pause |

## Run it locally

Browsers block ES modules when you open `index.html` straight from disk, so
start a small local web server in the project folder:

```bash
# Python 3
python3 -m http.server 8000
# or Node
npx serve .
```

Then open <http://localhost:8000> and click **CLICK TO PLAY**.

## Connect to GitHub

This project already lives on GitHub at
[game943/counter-strike](https://github.com/game943/counter-strike).

### 1. Get the code on your computer

Install [Git](https://git-scm.com/downloads), then:

```bash
git clone https://github.com/game943/counter-strike.git
cd counter-strike
```

### 2. Tell Git who you are (one-time setup)

```bash
git config --global user.name  "Your Name"
git config --global user.email "you@example.com"
```

### 3. Log in to GitHub from your computer

GitHub no longer accepts your account password for `git push`. Use one of these:

- **Easiest:** install the [GitHub CLI](https://cli.github.com) and run
  `gh auth login`, then follow the prompts.
- **Personal access token:** create one at
  GitHub → Settings → Developer settings → Personal access tokens, and paste it
  as the password when `git push` asks.
- **SSH key:** run `ssh-keygen -t ed25519`, add the `.pub` file's contents at
  GitHub → Settings → SSH and GPG keys, then use the SSH URL
  `git@github.com:game943/counter-strike.git`.
- **No command line:** [GitHub Desktop](https://desktop.github.com) does all of
  the above with buttons.

### 4. Save and upload your changes

```bash
git add .
git commit -m "Describe what you changed"
git push
```

### 5. Put the game online for free (GitHub Pages)

1. On GitHub, open the repository and go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*.
3. Pick the `main` branch and the `/ (root)` folder, then click **Save**.
4. After a minute the game is live at
   **https://game943.github.io/counter-strike/**. Share that link with anyone.

## Project layout

```
index.html   page + HUD markup, loads Three.js from a CDN
style.css    HUD and menu styling
game.js      everything else: map, physics, weapons, bots, rounds, audio
```

Tweaking ideas: weapon stats are in the `WEAPONS` table in `game.js`, the map
is built from the `addBox(...)` / `crate(...)` calls under `// Map`, and bot
difficulty is in `Bot.shoot` and `startRound`.

---

This is a fan-made learning project and isn't affiliated with or endorsed by
Valve. It contains no Valve code or assets.
