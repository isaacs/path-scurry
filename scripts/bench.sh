#!/usr/bin/env bash

chmod 0755 scripts/benchmark-*
for script in scripts/benchmark-*; do
  echo ----- $script -----
  $script
done
