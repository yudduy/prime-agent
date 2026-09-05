class ModelNew(Model):
    @torch.compile(backend="inductor", fullgraph=True, dynamic=False)
    def forward(self, x):
        x = self.conv_transpose(x)
        x = x + self.bias
        x = torch.clamp(x, min=0.0, max=1.0)
        x = x * self.scaling_factor
        x = torch.clamp(x, min=0.0, max=1.0)
        return x / self.scaling_factor
