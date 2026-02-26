#!/bin/bash
set -e
mkdir -p otp/data
echo "Downloading Estonia GTFS data..."
curl -L -o otp/data/gtfs.zip https://peatus.ee/gtfs/gtfs.zip
echo "GTFS data downloaded to otp/data/gtfs.zip"
