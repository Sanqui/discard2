# discard2
Archival tool.

## Usage
WIP.

Capture tools supported without Docker: `none`, `mitmproxy`

```bash
npm run start -- -c none profile
npm run start -- -c none channel 954365197735317514 954365219411460138 --after 2010-01-01 --before 2023-03-18
```

Docker:

```bash
docker build -f Containerfile -t discard2 --target run .
docker run --env-file=.env -v $PWD/out:/app/out:rw discard2 -- -c none --headless profile
```

## Run tests

```bash
docker build -f Containerfile -t discard2-test --target test .
docker run discard2-test
```

## Troubleshooting

`Caught error: EACCES: permission denied, mkdir 'out/2022-03-31T11:51:26.131Z-profile'`

Since the Docker container uses an unpriviledged user to run node, the permissions on the output directory must be more lenient, e.g. `chmod -R 777 out/`.