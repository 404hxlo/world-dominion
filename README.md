# World Dominion

A real-time world-conquest game in the browser. Pick any nation, raise armies, fleets, aircraft and missiles, research up to nukes, make and break alliances, and take over the world against AI rivals or your friends.

**Play:** https://404hxlo.github.io/world-dominion/

## Playing with friends

1. Open the game, type your name under **Play with friends** and click **Host a game**.
2. In the lobby, click **Copy invite link** and send it to your friends. The link opens the game with your room code filled in; they type a name and click **Join**.
3. Everyone picks a nation on the globe, then the host chooses the rules and starts the war.

The host's browser runs the war, so the host keeps the game open. Up to 8 players.

## On phones

The game plays in mobile browsers, upright or sideways. Tap one of your nations to select it, tap a target to see your odds and attack, and pinch to zoom. To play fullscreen without the browser bars, add the game to your home screen: on an iPhone, Share → Add to Home Screen; on Android, the 📲 button on the title screen or Install app in the browser menu.

Phones pause web pages that aren't on screen, so a host on a phone should keep the game open in front.

## Offline copy

`share/World-Dominion.html` is the whole game in one file, for sending to someone directly. Rebuild it after changing the game with `node tools/bundle.js`.

## Credits

Map data from [world-atlas](https://github.com/topojson/world-atlas) (Natural Earth), flags from [flag-icons](https://github.com/lipis/flag-icons), built with [D3](https://d3js.org), [TopoJSON](https://github.com/topojson/topojson) and [PeerJS](https://peerjs.com).
