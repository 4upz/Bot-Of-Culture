#!/bin/bash
# Used for building and pushing a container version of the app to GCP, and to remind me of the commands lol
docker build -t gcr.io/bot-of-culture/bot-of-culture .
docker push gcr.io/bot-of-culture/bot-of-culture
