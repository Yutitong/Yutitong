"""マップのデータ。

rows の1文字が1マス。記号の意味は tiles.py を見ること。
portals は「そのマスに乗ったら別のマップへ移動する」場所。
npcs は話しかけられる人。kind で反応が変わる。
"""

MAPS = {
    "village": {
        "name": "はじまりのむら",
        "rows": [
        "TTTTTTTTTTT__TTTTTTTTTTT",
        "T..........__..........T",
        "T........T.__.T........T",
        "T..RRRR....__...RRRR...T",
        "T..RRRR....__...RRRR...T",
        "T..BDWB....__...BWDB...T",
        "T.T........__........T.T",
        "T....F.....__.....F....T",
        "T..__________________..T",
        "T..__________________..T",
        "T......F...__...F......T",
        "T.T........__..T.......T",
        "T..RRRR.T..__...RRRRF..T",
        "T..RRRR....__...RRRR...T",
        "T..BDWB....__...BWDB...T",
        "T..F..~~~.F__F.......T.T",
        "T.....~~~..__..........T",
        "TTTTTTTTTTTTTTTTTTTTTTTT",
        ],
        "encounter": None,
        "portals": {
            (11, 0): ("field", 19, 28),
            (12, 0): ("field", 20, 28),
        },
        "npcs": [
            {"x": 13, "y": 1, "dir": "down", "sprite": "soldier", "name": "へいし", "kind": "talk",
             "lines": ["ようこそ はじまりの むらへ！",
                       "きたの どうくつに まおうが すみついてから\nまものが ふえて こまっているんだ。",
                       "きたの もんの さきは キケンだ。\nじゅんびを してから いくのだぞ。"],
             "lines_cleared": ["まおうを たおしたって！？\nおまえさんは このくにの えいゆうだ！"]},

            {"x": 4, "y": 6, "dir": "down", "sprite": "merchant", "name": "どうぐや", "kind": "shop",
             "lines": ["いらっしゃい！\nたびの どうぐは そろってるよ。"]},

            {"x": 18, "y": 6, "dir": "down", "sprite": "woman", "name": "やどや", "kind": "inn",
             "lines": ["やどやへ ようこそ。"]},

            {"x": 18, "y": 15, "dir": "down", "sprite": "elder", "name": "ちょうろう", "kind": "elder",
             "lines": ["おお ゆうしゃよ……\nよくぞ きて くだされた。",
                       "きたの どうくつの おくに\nまおうが ひそんで おるのじゃ。",
                       "どうか まおうを たおして\nこの くにに ひかりを もどして くだされ！"],
             "lines_after": ["どうくつは きたの もんを ぬけた さきじゃ。\nくさむらには きを つけるのじゃぞ。"],
             "lines_cleared": ["まおうは たおれた……\nありがとう、まことの ゆうしゃよ。"]},

            {"x": 8, "y": 7, "dir": "down", "sprite": "villager", "name": "むらびと", "kind": "talk",
             "lines": ["くさむらや どうくつでは まものが でる。",
                       "HPが へったら やどやで やすむと いい。\nゴールドは たいせつにな。"]},

            {"x": 14, "y": 10, "dir": "left", "sprite": "woman", "name": "むすめ", "kind": "talk",
             "lines": ["レベルが あがると つよい じゅもんを\nおぼえるって おとうさんが いってた。",
                       "たたかうのが つらく なったら\nくさむらで レベルを あげるといいよ。"]},

            {"x": 4, "y": 15, "dir": "down", "sprite": "villager", "name": "しょうねん", "kind": "talk",
             "lines": ["メニューは ESCキーで ひらけるよ！\nそこで セーブも できるんだ。"]},
        ],
    },

    "field": {
        "name": "そうげん",
        "rows": [
        "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
        "T^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^T",
        "T^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^T",
        "T^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^T",
        "T^^^^^^^^^^^^^^^^^^DD^^^^^^^^^^^^^^^^^^T",
        "T^^^^^^^^^^^^^^^^^^__^^^^^^^^^^^^^^^^^^T",
        "T..............T...__.........SSS......T",
        "T..,,F,,,,,....T...__.....T,,,SSS,,..T.T",
        "T.F,,,,,,,,.....T..__.....,,,,F,T,,....T",
        "T..,,T,,,,,.T,,,,..__.....T,,,,,,,,T...T",
        "TT.,,,,,,,,.T,,,,..__....T,,,,,,,,,....T",
        "T..,,,,,,,,..,,,T..__.....,,,,,,,,,...TT",
        "T.~~~~~............__.....,,,,,,,,,....T",
        "T.~~~~~............__....T.............T",
        "T.~~~~~............__..................T",
        "T........T.........__........T.......T.T",
        "~~~~~~~~~~~~~~~~~~~==~~~~~~~~~~~~~~~~~~~",
        "~~~~~~~~~~~~~~~~~~~==~~~~~~~~~~~~~~~~~~~",
        "T...............T..__...............T.TT",
        "T.....T..F.........__..................T",
        "T...F.........T....__....,,,,,,,T,,...TT",
        "T....,,,,,T,,,,....__...T,,,,,,,,,F....T",
        "T...T,,,,,,,,,,....__....,,,,,,,,,,....T",
        "T....T,F,,,,,,,....__....,T,,,,,,,,....T",
        "TT..T,,,,,,,,,,....__..,,,,,,,,,,,,....T",
        "T....,,,,,,T,,,....__.TTT,,,,,,,,,,....T",
        "T....,,,,,,,,,,T...__..,,,T,,,,,,,,....T",
        "T..................__..,,T,.....T....F.T",
        "T........F.........__..................T",
        "TTTTTTTTTTTTTTTTTTT__TTTTTTTTTTTTTTTTTTT",
        ],
        "encounter": {"rate": 26, "table": [("slime", 4), ("rat", 3), ("goblin", 2), ("mage", 1)]},
        "portals": {
            (19, 29): ("village", 11, 1),
            (20, 29): ("village", 12, 1),
            (19, 4): ("cave", 11, 18),
            (20, 4): ("cave", 12, 18),
        },
        "npcs": [
            {"x": 21, "y": 6, "dir": "left", "sprite": "villager", "name": "たびびと", "kind": "talk",
             "lines": ["きたの どうくつの まものは つよい。",
                       "レベル8くらいは ないと\nまおうには かてないだろうな……"]},
        ],
    },

    "cave": {
        "name": "まおうの どうくつ",
        "rows": [
        "XXXXXXXXXXXXXXXXXXXXXXXX",
        "XXXXXXXXXXXXXXXXXXXXXXXX",
        "XXXXXXXXCCCCCCCCXXXXXXXX",
        "XXXXXXXXCCCCCCCCXXXXXXXX",
        "XXXXXXXXCCCCCCCCXXXXXXXX",
        "XXXXXXXXCCCCCCCCXXXXXXXX",
        "XXXXXXXXCCCCCCCCXXXXXXXX",
        "XXXXXXXXXXXCCXXXXXXXXXXX",
        "XXXXCCCCCXXCCXXCCCCCXXXX",
        "XXXXCCCCCXXCCXXCCCCCXXXX",
        "XXXXCCXXXXXCCXXXXXCCXXXX",
        "XXXXCCXXXXXCCXXXXXCCXXXX",
        "XXXXCCCCCCCCCCCCCCCCXXXX",
        "XXXXCCCCCCCCCCCCCCCCXXXX",
        "XXXXXXXXXXXCCXXXXXXXXXXX",
        "XXXXXXXXXXXCCXXXXXXXXXXX",
        "XXXCCCCCCCCCCXXXXXXXXXXX",
        "XXXCCCCCCCCCCXXXXXXXXXXX",
        "XXXCCXXXXXXCCXXXXXXXXXXX",
        "XXXXXXXXXXXCCXXXXXXXXXXX",
        ],
        "encounter": {"rate": 18, "table": [("rat", 2), ("goblin", 4), ("mage", 4)]},
        "portals": {
            (11, 19): ("field", 19, 5),
            (12, 19): ("field", 20, 5),
        },
        "npcs": [
            {"x": 11, "y": 3, "dir": "down", "sprite": "villager", "name": "まおう", "kind": "boss",
             "lines": ["……よくぞ ここまで きたな、にんげん。",
                       "この どうくつは わがしろ。\nいきて かえれると おもうな！"]},
        ],
    },
}


def get_map(key):
    return MAPS[key]


def tile_at(mapdata, x, y):
    """マップの外は かべ あつかいにする。"""
    rows = mapdata["rows"]
    if y < 0 or y >= len(rows) or x < 0 or x >= len(rows[0]):
        return "X"
    return rows[y][x]
