# Set-up

Start the service with:
```shell
$ yarn run dev
```

And configuration Claude with:

```shell
$ claude mcp add poc-aap-mcp -t http http://localhost:3000/mcp -H 'Authorization: Bearer WYEwQQoMbuOeVrqUx1xV7F9p2nBlb2'
```

# You can also define the Bearer token at the service level

```shell
$ $EDITOR .env
$ source .env
$ yarn run dev
```

And register the MCP server like this:

```shell
$ claude mcp add poc-aap-mcp -t http http://localhost:3000/mcp
```
