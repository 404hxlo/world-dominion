# World Dominion

A real-time world-conquest game in the browser. Pick any nation, raise armies, fleets, aircraft and missiles, research up to nukes, make and break alliances, and take over the world against AI rivals or your friends.

**Play:** https://404hxlo.github.io/world-dominion/

## Playing with friends

1. Open the game, type your name under **Play with friends** and click **Host a game**.
2. In the lobby, click **Copy invite link** and send it to your friends. The link opens the game with your room code filled in; they type a name and click **Join**.
3. Everyone picks a nation on the globe, then the host chooses the rules and starts the war.

The host's browser runs the war, so the host keeps the game open. Up to 8 players.

## Offline copy

`share/World-Dominion.html` is the whole game in one file, for sending to someone directly. Rebuild it after changing the game with `node tools/bundle.js`.

## Credits

Map data from [world-atlas](https://github.com/topojson/world-atlas) (Natural Earth), flags from [flag-icons](https://github.com/lipis/flag-icons), built with [D3](https://d3js.org), [TopoJSON](https://github.com/topojson/topojson) and [PeerJS](https://peerjs.com).
