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
docker run --env-file=.env -v $PWD/out:/app/out:Z,U --cap-add=NET_RAW --cap-add=NET_ADMIN 
    discard2 -- -c tshark --headless profile
```

To use the `tshark` capture tool without Docker, you need to add your user to the wireshark group:

```bash
sudo usermod -a -G wireshark [your_username]
```

**Warning!**  When you choose the `tshark` capture tool outside of Docker, **all traffic** on your system gets saved.  Only use this capture without Docker for testing purposes, never publish them.

## Run tests

```bash
docker build -f Containerfile -t discard2-test --target test .
docker run discard2-test
```