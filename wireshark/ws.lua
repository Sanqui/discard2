-- Inspired by
-- https://osqa-ask.wireshark.org/questions/60725/how-to-dump-websockets-live-with-tshark/
-- ref: https://www.wireshark.org/docs/wsdg_html_chunked/lua_module_Proto.html
local myproto = Proto("websocket_data", "Websocket Data")
myproto.fields.data = ProtoField.string("websocket_data.data", "Websocket data")
function myproto.dissector(tvb, pinfo, tree)
    tree:add(
        myproto.fields.data,
        tvb():bytes():tohex()
    )
end
local function myproto_heur(tvb, pinfo, tree)
    myproto.dissector(tvb, pinfo, tree)
    return true -- accept all Websockets data (do not call other dissectors)
end
myproto:register_heuristic("ws", myproto_heur)
