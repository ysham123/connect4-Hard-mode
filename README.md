# OVERDROP

Four in a row, turned all the way up. Play online with friends (1v1, 2v2 teams, or 3 and 4 player free for all), pass one screen around, or practice against a bot.

No accounts, no server to run, no environment variables. It is a static site that deploys to Vercel as is.

## What makes it harder

| Mechanic | What it does |
| --- | --- |
| Shot clock | Every move is timed (Overdrive default is 15s). Run out and a disc drops for you in a random column. |
| Energy | You gain 1 energy at the start of each turn, up to 6. Everyone can see everyone's energy. Resets each round. |
| Wall (2) | Drop a neutral steel block, then still take your normal drop. Fill the gap under a cell you want, or plug a threat. |
| Bomb (4) | Destroy any enemy disc or wall. The column above falls. If the fall completes only the enemy's line, they win (backfire). |
| Surge (6) | Drop two discs in one turn. |
| Floor collapse | Every N turns the bottom row is destroyed and the whole board drops one row. A full board collapses instead of stalling. |
| Match play | First to 1, 2, 3 or 5 rounds. The first move rotates every round. |

One ability per turn. Because walls and surges exist, threats that are one or two moves away are live, so you have to read the board (and the energy bars) a lot more carefully than in the classic game.

Presets: **Overdrive** (9 x 7, 15s clock, abilities, collapse every 12 turns, first to 3), **Blitz** (8 x 7, 6s clock, collapse every 10), and **Classic** (7 x 6, no clock, no abilities, first to 1). Every setting can be changed in the lobby.

## Playing with friends

1. Open the site, enter a name, press **Create online room**.
2. Send the invite link (or the 5 letter room code) to your friends.
3. Pick a mode and settings, then **Start match** once every seat is filled. Extra people join as spectators.

Guests who refresh or drop briefly reconnect to the same seat automatically. The host's tab must stay open, since the host's browser runs the match.

## Deploy to Vercel

The repo root is the site. There is no build step.

**From the dashboard**

1. In Vercel, choose **Add New > Project** and import this repository.
2. Framework preset: **Other**. Leave the build command empty and keep the output directory as the root.
3. Deploy. Share the URL with your friends.

**From the command line**

```bash
npx vercel
```

```bash
npx vercel --prod
```

## How online play works

Online rooms are peer to peer. The host's browser runs the authoritative game, and each guest connects directly to it over a WebRTC data channel using [PeerJS](https://peerjs.com/) (vendored in `vendor/`, MIT license). The free public PeerJS server is only used to introduce the browsers to each other, and its default relay servers help when a direct connection is not possible. No game data is stored anywhere.

Some strict networks (certain school or office Wi-Fi) block peer to peer traffic. If a friend cannot connect, have them try another network or mobile data.

To use your own signaling server instead of the public one, add these to the URL:

```
?peerhost=your.server.com&peerport=443&peersecure=1&peerpath=/
```

## Local development

Any static file server works. For example:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080. To test online play in a single browser without the network, add `?net=local` to the URL and open the host and guests in separate tabs.

## Tests

The rules engine has unit tests that run on Node 22 or newer with no dependencies:

```bash
node --test tests/*.test.mjs
```

## Project layout

```
index.html            page shell
css/style.css         all styles
js/engine.js          pure game rules (no DOM, no network)
js/bot.js             practice bot (search plus ability planning)
js/bot.worker.js      runs the bot off the main thread
js/room.js            authoritative match host: lobby, seats, clocks, bot turns
js/net.js             host, guest and local sessions plus transports
js/ticker.worker.js   steady host clock that keeps time in background tabs
js/audio.js           synthesized sound effects
js/main.js            app entry and screen routing
js/ui/                home, lobby, match screen, board renderer, rules, helpers
tests/                engine tests
vendor/               PeerJS browser bundle and license
```

## Controls

- Click a column to drop. On phones, tap once to aim and again to confirm.
- Number keys drop into a column (1 to 9, 0 for the tenth). Arrow keys aim, Enter drops.
- W wall, B bomb (aim with arrow keys), S surge, Esc cancels.
