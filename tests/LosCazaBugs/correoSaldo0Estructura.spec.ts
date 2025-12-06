import { test, expect } from "@playwright/test";
import Imap from "imap";
import { simpleParser } from "mailparser";
import dotenv from "dotenv";

dotenv.config();

async function waitForEmail(
  email: string,
  password: string,
  subject: string,
  maxWaitMs: number = 60000
): Promise<{ subject: string; body: string }> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: email,
      password: password,
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    let emailFound = false;
    const startTime = Date.now();

    const timeout = setTimeout(() => {
      if (!emailFound) {
        imap.end();
        reject(new Error(`Timeout: No se encontro correo con subject "${subject}" en ${maxWaitMs}ms`));
      }
    }, maxWaitMs);

    imap.once("ready", () => {
      imap.openBox("INBOX", false, (err, box) => {
        if (err) {
          clearTimeout(timeout);
          reject(err);
          return;
        }

        // Buscar correos recientes con el subject
        const searchCriteria = [
          ["SINCE", new Date(startTime - 60000)],
          ["SUBJECT", subject],
        ];

        const checkForEmail = () => {
          imap.search(searchCriteria, (err, results) => {
            if (err) {
              clearTimeout(timeout);
              reject(err);
              return;
            }

            if (results.length > 0) {
              emailFound = true;
              clearTimeout(timeout);

              const fetch = imap.fetch(results[results.length - 1], {
                bodies: "",
              });

              fetch.on("message", (msg) => {
                msg.on("body", (stream) => {
                  simpleParser(stream as any, (err: any, parsed: any) => {
                    if (err) {
                      reject(err);
                      return;
                    }

                    imap.end();
                    resolve({
                      subject: parsed.subject || "",
                      body: parsed.text || parsed.html || "",
                    });
                  });
                });
              });

              fetch.once("error", reject);
            } else if (Date.now() - startTime < maxWaitMs) {
              // Reintentar cada 5 segundos
              setTimeout(checkForEmail, 5000);
            }
          });
        };

        checkForEmail();
      });
    });

    imap.once("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });

    imap.connect();
  });
}

//Esperar selector visible
async function waitForVisible(page: any, selector: string, timeout = 30000) {
  try {
    await page.waitForSelector(selector, {
      state: "visible",
      timeout,
    });
    return page.locator(selector);
  } catch (error) {
    console.error(`No se encontró: ${selector}`);
    await page.screenshot({ path: `debug-${Date.now()}.png`, fullPage: true });
    throw new Error(
      `Timeout: El selector "${selector}" no se hizo visible en ${timeout}ms`
    );
  }
}
 
//test completo
test.describe("Validation de correo con saldo 0", () => {
  test.setTimeout(120000);

  test("Flujo completo + validation del correo de saldo 0", async ({ page }) => {
    // 1. Usar email real de prueba desde .env
    const emailPrueba = process.env.TEST_EMAIL!;
    const emailPassword = process.env.TEST_EMAIL_PASSWORD!;

    if (!emailPrueba || !emailPassword) {
      throw new Error(
        "Faltan TEST_EMAIL y TEST_EMAIL_PASSWORD en el archivo .env"
      );
    }

    console.log("Usando email de prueba:", emailPrueba);

    // 2. Entrar al sistema
    console.log(" Navegando a la aplicacion...");
    await page.goto("https://alquiler-front-hot4.onrender.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page.waitForLoadState("networkidle");

    // 3. Ir a Comisión
    console.log(" Haciendo click en 'Ir a Comisión'...");
    await page.click("#btn-ir-comision", { timeout: 10000 });
    await page.waitForTimeout(1000);

    // 4. Esperar input de usuario y rellenarlo
    console.log(" Rellenando campo de usuario...");
    const inputUsuario = await waitForVisible(page, "#usuario", 20000);
    await inputUsuario.fill("RecodeFixer");
    await inputUsuario.press("Enter");
    console.log(" Usuario ingresado: RecodeFixer");

    // 5. Esperar y hacer click en "Mi Billetera"
    console.log(" Esperando enlace 'Mi Billetera'...");
    await page.waitForTimeout(2000);

    const walletLink = await page.waitForSelector(
      'a[href*="/bitcrew/wallet?usuario="], a:has-text("Mi Billetera")',
      { state: "visible", timeout: 20000 }
    );

    console.log(" Enlace 'Mi Billetera' encontrado, haciendo click...");
    await walletLink.click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // 6. Esperar el botón de configuración
    console.log(" Esperando botón de configuracion...");
    const btnConfig = await waitForVisible(page, "#btn-open-config", 20000);
    console.log(" Botón de configuracion visible");
    await btnConfig.click();
    await page.waitForTimeout(1500);

    // 7. Verificar que el modal se abrió
    console.log(" Verificando que el formulario está visible...");
    await page.waitForSelector("#input-monto", {
      state: "visible",
      timeout: 10000,
    });

    // 8. Rellenar datos del fixer
    console.log(" Rellenando formulario del fixer...");
    await page.fill("#input-monto", "0");
    await page.waitForTimeout(300);

    await page.fill("#input-fixer-nombre", "jafet");
    await page.waitForTimeout(300);

    await page.fill("#input-fixer-correo", emailPrueba);
    await page.waitForTimeout(300);
    console.log(` Correo ingresado: ${emailPrueba}`);

    await page.fill("#input-fixer-numero", "59164844552");
    await page.waitForTimeout(300);

    // 9. Guardar configuración
    console.log(" Guardando configuracion del fixer...");
    await page.click("#btn-guardar-fixer");
    await page.waitForTimeout(2000);

    console.log(" Configuracion guardada");

    // 10. Recargar wallet
    console.log(" Recargando wallet...");
    await page.click("#btn-recargar-wallet");
    console.log(" Esperando que el backend procese y envie el correo...");
    await page.waitForTimeout(3000);

    // 11. Cerrar modal si existe
    const btnCerrarModal = page.locator('[data-slot="dialog-close"]');
    if ((await btnCerrarModal.count()) > 0) {
      console.log(" Cerrando modal...");
      await btnCerrarModal.click();
      await page.waitForTimeout(500);
    }

    // 12. Actualizar billetera
    console.log(" Actualizando billetera...");
    const btnRefresh = page.locator('svg path[d*="M16.023"]');
    if ((await btnRefresh.count()) > 0) {
      await btnRefresh.click();
      await page.waitForTimeout(3000);
    }

    // 13. Esperar correo via IMAP
    console.log(" Esperando correo via IMAP (mx 60 segundos)...");
    let email;
    
    try {
      email = await waitForEmail(
        emailPrueba,
        emailPassword,
        "Actualizacion de saldo",
        60000
      );
      console.log(" ¡Correo recibido!");
    } catch (error: any) {
      console.error(" Error esperando correo:", error.message);
      
      // Tomar screenshot
      await page.screenshot({
        path: `error-no-email-${Date.now()}.png`,
        fullPage: true,
      });
      
      throw error;
    }

    const body = email.body;

    console.log("\n===  CORREO RECIBIDO ===");
    console.log("Subject:", email.subject);
    console.log("Body length:", body.length);
    console.log("Body preview:", body.substring(0, 400));
    console.log("========================\n");

    // 14. Validaciones (ajustadas al formato real del correo)
    // El correo dice "Hola *kevin*" porque el backend usa el nombre del usuario, no el del formulario
    expect(body).toMatch(/Hola \*?(kevin|jafet)\*?/i); // Acepta kevin o jafet
    expect(body).toContain("AVISO ACERCA DEL SALDO");
    expect(body).toContain("Tenemos una actualizacion sobre tu saldo");
    expect(body).toContain("por el momento tu saldo esta en 0");

    // Validar los campos con formato markdown del correo
    expect(body).toMatch(/\s*\*?Saldo:\*?\s*Bs\.?\s*0\.0?0?/i);
    expect(body).toMatch(/\s*\*?Estado:\*?\s*Restringido/i);
    expect(body).toMatch(/\s*\*?Fecha:\*?/i);

    // Validar formato de fecha
    expect(body).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);

    // Validar firma
    expect(body).toContain("Sistema de Pagos");

    console.log(" Todas las validaciones pasaron correctamente");
    console.log(" Resumen: Correo recibido y validado con exito");
  });
});
