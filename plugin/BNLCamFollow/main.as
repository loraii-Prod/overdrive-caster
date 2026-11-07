// BNL Cam Follow — tells the caster system who you are spectating, so the
// player cam on stream switches automatically when you switch target in game.

[Setting category="General" name="Enabled"]
bool S_Enabled = true;

[Setting category="General" name="Server URL" description="Address of the caster system (Start GLACIAL Caster.bat)"]
string S_Url = "__URL__";

[Setting category="General" name="API token" password description="Controller → Settings → Stream Deck / Companion"]
string S_Token = "__TOKEN__";

[Setting category="General" name="Check interval (ms)" min=50 max=1000]
int S_Interval = 150;

string g_lastKey = "\x01";
string g_status = "starting";

void Main() {
    while (true) {
        if (S_Enabled) {
            Tick();
        }
        sleep(S_Interval);
    }
}

// Name + login of the player shown on screen (the spectated player, or you while driving).
string GetTarget(string &out login) {
    login = "";
    auto app = cast<CTrackMania>(GetApp());
    if (app is null) return "";
    auto pg = cast<CSmArenaClient>(app.CurrentPlayground);
    if (pg is null || pg.GameTerminals.Length == 0) return "";
    auto player = cast<CSmPlayer>(pg.GameTerminals[0].GUIPlayer);
    if (player is null) return "";
    auto api = cast<CSmScriptPlayer>(player.ScriptAPI);
    if (api is null || api.User is null) return "";
    login = api.User.Login;
    return string(api.User.Name);
}

void Tick() {
    string login;
    string name = GetTarget(login);
    string key = name + "\n" + login;
    if (key == g_lastKey) return;
    g_lastKey = key;
    string url = S_Url + "/api/v1/spectate?token=" + Net::UrlEncode(S_Token)
        + "&name=" + Net::UrlEncode(name) + "&login=" + Net::UrlEncode(login);
    auto req = Net::HttpGet(url);
    while (!req.Finished()) {
        yield();
    }
    int code = req.ResponseCode();
    if (code == 200) {
        g_status = name.Length > 0 ? "following " + name : "no target";
    } else {
        g_status = "error " + code + " (check Server URL / token)";
        g_lastKey = "\x01"; // retry next tick
    }
}

void RenderMenu() {
    if (UI::MenuItem("\\$f33" + Icons::VideoCamera + "\\$z BNL Cam Follow", g_status, S_Enabled)) {
        S_Enabled = !S_Enabled;
    }
}
