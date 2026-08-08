-- Somewhere to put car-connection state (CarPlay, Android Auto, car
-- Bluetooth, car audio).
--
-- The native detection for this already exists on BOTH platforms and has
-- never produced a single row:
--
--   android/app/src/main/java/com/taxottic/app/TaxotticCarSignalsPlugin.java
--     built, and registered in MainActivity
--   ios/App/App/TaxotticVehicleSignals.swift
--     built, audio-route based
--   lib/mileage/car-signals.ts
--     built, with a typed signal and power model
--
-- Nothing ever called getCarSignalsState(), and there was no column to put
-- the answer in. Three layers of correct-looking implementation delivering
-- zero rows. This migration is the missing end of that chain.
--
-- WHY car_probe IS A FIRST-CLASS COLUMN AND NOT AN AFTERTHOUGHT.
--
-- The read rides the JS-to-native call path that has failed on 450 of 450
-- device-truth heartbeats (device_probe='timeout', stage='bridge'). So
-- there is a real chance every row here lands as 'timeout' too. If that
-- happens it is a FINDING, not an empty column: it is a second, independent
-- confirmation that the request/response direction of the bridge does not
-- work, measured by different code against a different plugin.
--
-- The contrast that makes it diagnostic: native-to-JS callbacks DO work.
-- 66,588 GPS points arrived through bg.start(options, callback). So the
-- bridge is not dead, only the direction this call uses. A 'timeout' here
-- narrows that considerably; an 'ok' here would mean the device-truth
-- failure is specific to TaxotticDeviceStatus rather than to the path.
--
-- Either answer is worth more than the silence we have now, which is the
-- entire point of shipping it this way.
--
-- All nullable: NULL means a client predating these columns.

alter table public.mileage_device_heartbeats
  add column if not exists car_probe               text,
  add column if not exists car_probe_ms            integer,
  add column if not exists car_projection_type     text,
  add column if not exists car_projection_observed boolean,
  add column if not exists car_connects            integer,
  add column if not exists car_disconnects         integer,
  add column if not exists car_bluetooth_adapter   text,
  add column if not exists car_pending_signals     integer;

comment on column public.mileage_device_heartbeats.car_probe is
  'Outcome of the car-signals read: ok | unavailable | null | error | timeout. Read this BEFORE the other car_* columns. "timeout" means the JS-to-native bridge did not answer, which is a finding about the bridge, not an absence of cars.';

comment on column public.mileage_device_heartbeats.car_projection_type is
  'CarPlay / Android Auto projection state as reported by the native side. Meaningful only when car_probe = ok.';
