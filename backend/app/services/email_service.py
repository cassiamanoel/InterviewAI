class EmailService:
    def __init__(self):
        # In a real SaaS setup, you'd configure Resend / Sendgrid here
        self.api_key = "stub-api-key"

    async def send_welcome_email(self, user_email: str, user_name: str) -> bool:
        """
        Stub to send welcome email upon successful signup.
        """
        print(f"📧 [EmailService] Sending welcome email to {user_email} ({user_name})")
        # Example pseudo-code for sending email:
        # await sendgrid.send(to=user_email, template="welcome")
        return True

    async def send_password_reset(self, user_email: str, reset_token: str) -> bool:
        """
        Stub to send password reset token.
        """
        print(f"📧 [EmailService] Sending password reset link to {user_email}. Token: {reset_token}")
        return True

email_service = EmailService()
