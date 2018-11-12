This is just a lil' Discord bot for managing my server.

It takes a TOML config file that looks like this:

```
name = "bot's name for identifying itself"
token = "TOKENVALUE"
superadmin = "#####" # The discord acct id (a number) of the user who can /reload-db * /reload-subs

[servers."SERVERNAME".channels]
```
