// Date behaviour depends on the device time zone, so tests pin it to the product's home zone.
// Tests that need another zone set process.env.TZ themselves and restore it afterwards.
process.env.TZ = 'Asia/Kolkata';
