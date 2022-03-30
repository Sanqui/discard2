# discard2
Archival tool.

## Usage
WIP.

```bash
npm run start -- profile
npm run start -- channel 954365197735317514 954365219411460138 --after 2010-01-01 --before 2023-03-18
```

## Run tests in Docker or Podman

```bash
docker build -f Containerfile -t discard2-test --target test .
docker run discard2-test
```
