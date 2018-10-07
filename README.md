This is just a lil' Discord bot for managing my server.

It takes a TOML config file that looks like this:

```
token = "TOKENVALUE"

[servers."SERVERNAME".channels]
moderation = "moderation"
welcome = "welcome"
deleteReports = false
```

* `moderation` is the channel /admin and /report should go to
* `welcome` is the channel that new user welcome messages go to
* if `deleteReports` is true then public channel /admin and /report test will be deleted when the bot sees it and confirmation will be sent via DM instead of reactji. Reports are visible for a flash, but long enough to see who did it if you're looking, which is I'm not running with this.
