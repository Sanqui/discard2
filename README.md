# discard2
Archival tool.

## Usage
WIP.

Capture tools supported without Docker: `none`, `mitmproxy`

```bash
npm run start -- profile -c none
npm run start -- channel 954365197735317514 954365219411460138 -c none --after 2010-01-01 --before 2023-03-18
```

Docker:

```bash
docker build -f Containerfile -t discard2 --target run .
docker run --env-file=.env -v $PWD/out:/app/out:Z,U --cap-add=NET_RAW --cap-add=NET_ADMIN -it \
    discard2 -- profile -c tshark --headless
```

To use the `tshark` capture tool without Docker, you need to add your user to the wireshark group:

```bash
sudo usermod -a -G wireshark [your_username]
```

**Warning!**  When you choose the `tshark` capture tool outside of Docker, **all traffic** on your system gets saved.  Only use this capture without Docker for testing purposes, never publish them.

## Processing

To convert captures into JSONL suitable for further processing, use:
```bash
npm run --silent start -- reader -f jsonl [job_directory] > out.jsonl
```

## Run tests

```bash
npm t
```

Or in Docker/Podman:

```bash
docker build -f Containerfile -t discard2-test --target test .
docker run --cap-add=NET_RAW --cap-add=NET_ADMIN  discard2-test
```