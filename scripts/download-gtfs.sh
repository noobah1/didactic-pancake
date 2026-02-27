#!/bin/bash
set -e
mkdir -p otp/data
echo "Downloading Estonia GTFS data..."
curl -L -o otp/data/gtfs.zip https://eu-gtfs.remix.com/tallinn.zip
echo "GTFS data downloaded to otp/data/gtfs.zip"
echo "Downloading ship GTFS data..."
curl -L -o otp/data/tslaevad.zip https://eu-gtfs.remix.com/tslaevad.zip
echo "Ship GTFS data downloaded to otp/data/tslaevad.zip"
